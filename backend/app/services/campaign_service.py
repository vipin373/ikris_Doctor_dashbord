"""Campaigns: doctors + FDA drug -> drafts (template / AI / manual) -> human approval -> send -> track.

Nothing is sent without an explicit approval, and sending re-checks the
doctor's frequency window, the drug's classification and the contact data.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from ..core.security import CurrentUser
from . import ai_message_service as ai
from . import email_service, whatsapp_service
from .doctor_matcher import (DRUG_COLUMNS, SENDABLE_CLASSIFICATION, areas_label, doctor_areas, drug_relevant,
                             drug_sendable, eligibility, pick_auto_drug)
from .message_render import (context_for, email_document, fact_guard, html_to_text, looks_like_html, plain_to_html,
                             render, unresolved)
from .whatsapp_service import ProviderNotConfigured, whatsapp_number

DOCTOR_COLUMNS = (
    "id,doctor_name,specialty,qualification,department,sub_department,institute,city,state,email,email_norm,"
    "contact_number,whatsapp_number,phone_norm,must_see,contact_frequency,frequency_days,last_message_sent_at,"
    "next_eligible_at,created_at,origin"
)
LIGHT_DRUG_COLUMNS = "id,drug_name,therapeutic_areas,classification_status,fda_status,latest_action_date"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def issue(level: str, text: str) -> dict[str, str]:
    return {"level": level, "text": text}


def blocking(issues: list[dict]) -> bool:
    return any(i.get("level") == "block" for i in issues)


async def fda_settings(db) -> dict[str, Any]:
    rows, _ = await db.select("app_settings", {"key": "eq.fda_settings", "select": "value"})
    return (rows[0]["value"] if rows else {}) or {}


async def _in_chunks(db, table: str, column: str, ids: list[str], select: str) -> list[dict]:
    out: list[dict] = []
    ids = list(dict.fromkeys(i for i in ids if i))
    for i in range(0, len(ids), 150):
        rows, _ = await db.select(table, [("select", select), (column, f"in.({','.join(ids[i:i + 150])})")])
        out.extend(rows)
    return out


def contact_for(doctor: dict, channel: str) -> str | None:
    if channel == "WHATSAPP":
        return whatsapp_number(doctor.get("whatsapp_number") or doctor.get("contact_number") or doctor.get("phone_norm"))
    return doctor.get("email_norm") or None


def channels_for(campaign_channel: str) -> list[str]:
    return ["WHATSAPP", "EMAIL"] if campaign_channel == "BOTH" else [campaign_channel]


# ------------------------------------------------------------------ create
async def create_campaign(db, user: CurrentUser, body: dict[str, Any]) -> dict[str, Any]:
    doctor_ids: list[str] = body["doctor_ids"]
    doctors = await _in_chunks(db, "doctors", "id", doctor_ids, DOCTOR_COLUMNS)
    if not doctors:
        raise HTTPException(404, "None of the selected doctors were found.")
    template = None
    if body["message_method"] == "TEMPLATE":
        if not body.get("template_id"):
            raise HTTPException(400, "Choose a template.")
        rows, _ = await db.select("message_templates", {"id": f"eq.{body['template_id']}", "deleted_at": "is.null",
                                                         "select": "*"})
        if not rows:
            raise HTTPException(404, "Template not found.")
        template = rows[0]
        if template["status"] != "ACTIVE":
            raise HTTPException(400, "Only active templates can be used. Activate it first.")
        if template["channel"] != "BOTH" and body["channel"] not in (template["channel"],):
            raise HTTPException(400, f"This template is for {template['channel'].title()} only.")

    manual_drug = None
    if body.get("drug_mode") == "MANUAL" or body.get("drug_id"):
        if not body.get("drug_id"):
            raise HTTPException(400, "Choose an FDA drug.")
        rows, _ = await db.select("fda_drugs", {"id": f"eq.{body['drug_id']}", "select": DRUG_COLUMNS})
        if not rows:
            raise HTTPException(404, "FDA drug not found.")
        manual_drug = rows[0]
        reason = drug_sendable(manual_drug)
        if reason:
            raise HTTPException(400, reason)

    candidates: list[dict] = []
    sent_map: dict[tuple[str, str], str] = {}
    if not manual_drug:
        candidates, _ = await db.select("fda_drugs", [
            ("select", LIGHT_DRUG_COLUMNS), ("classification_status", f"in.({','.join(SENDABLE_CLASSIFICATION)})"),
            ("fda_status", "not.is.null"), ("order", "latest_action_date.desc.nullslast,drug_name.asc"), ("limit", "3000"),
        ])
        history = await _in_chunks(db, "message_logs", "doctor_id", [d["id"] for d in doctors], "doctor_id,drug_id,sent_at,status")
        for h in history:
            if h.get("drug_id") and h["status"] in ("SENT", "DELIVERED", "READ"):
                sent_map[(h["doctor_id"], h["drug_id"])] = h["sent_at"]

    campaign = (await db.insert("campaigns", {
        "name": body["name"], "mode": body["mode"], "objective": body.get("objective"), "channel": body["channel"],
        "message_method": body["message_method"], "drug_mode": "MANUAL" if manual_drug else "AUTO",
        "drug_id": manual_drug["id"] if manual_drug else None, "template_id": template["id"] if template else None,
        "status": "DRAFT", "owner_role": user.role, "created_by": user.id,
    }, returning="*"))[0]

    used: dict[str, int] = {}
    rows_out = []
    upload_rows = body.get("upload_rows") or {}
    for d in doctors:
        areas = doctor_areas(d)
        drug_id = None
        status, skip, reason = "PENDING", None, None
        if manual_drug:
            drug_id = manual_drug["id"]
            if areas and not drug_relevant(manual_drug, areas):
                status, skip = "SKIPPED", f"{manual_drug['drug_name']} is not relevant to {areas_label(areas)}."
            elif not areas:
                if body["mode"] == "BULK":
                    status, skip = "SKIPPED", "No specialty match for this doctor; not sent specialty-specific drugs."
                else:
                    reason = "Chosen manually; the doctor has no oncology/hematology/rare-disease specialty on record."
            else:
                reason = f"Chosen manually; matches {areas_label([a for a in areas if a in manual_drug['therapeutic_areas']])}."
        else:
            if not areas:
                status, skip = "SKIPPED", "No oncology, hematology or rare-disease specialty on record; no drug matched."
            else:
                pool = []
                for c in candidates:
                    if set(c.get("therapeutic_areas") or []) & set(areas):
                        pool.append({**c, "last_sent_to_doctor": sent_map.get((d["id"], c["id"]))})
                pick = pick_auto_drug(pool, used)
                if not pick:
                    status, skip = "SKIPPED", f"No reviewed FDA drug for {areas_label(areas)} yet."
                else:
                    drug_id = pick["id"]
                    used[drug_id] = used.get(drug_id, 0) + 1
                    reason = f"Matched to {areas_label(areas)}" + (
                        "; already sent before" if pick.get("last_sent_to_doctor") else "; not sent to this doctor before")
        ok, until = eligibility(d)
        if status == "PENDING" and not ok:
            status, skip = "SKIPPED", f"Doctor is not eligible until {until[:10]} (contact frequency)."
        if status == "PENDING" and not any(contact_for(d, ch) for ch in channels_for(body["channel"])):
            status, skip = "SKIPPED", "Doctor information is incomplete: no " + (
                "WhatsApp number or email" if body["channel"] == "BOTH" else
                ("WhatsApp number" if body["channel"] == "WHATSAPP" else "email")) + "."
        rows_out.append({
            "campaign_id": campaign["id"], "doctor_id": d["id"], "department": d["department"], "drug_id": drug_id,
            "match_reason": reason, "status": status, "skip_reason": skip, "upload_row": upload_rows.get(d["id"]),
        })
    for i in range(0, len(rows_out), 500):
        await db.insert("campaign_doctors", rows_out[i:i + 500])
    counts = {"doctors": len(rows_out), "pending": sum(r["status"] == "PENDING" for r in rows_out),
              "skipped": sum(r["status"] == "SKIPPED" for r in rows_out)}
    return {"campaign": campaign, "counts": counts}


# ------------------------------------------------------------------ generate
async def _build(db, user: CurrentUser, campaign: dict, cd: dict, doctor: dict, drug: dict | None, channel: str,
                 template: dict | None, sender: dict, manual: dict | None) -> dict[str, Any]:
    ctx = context_for(doctor, drug, sender)
    issues: list[dict] = []
    subject: str | None = None
    body = ""
    params: list[str] = []
    ai_run_id = None
    method = campaign["message_method"]

    if method in ("TEMPLATE", "MANUAL"):
        src_subject = (manual or {}).get("subject") if method == "MANUAL" else (template or {}).get("subject")
        src_body = (manual or {}).get("body") if method == "MANUAL" else (template or {}).get("body")
        if not (src_body or "").strip():
            issues.append(issue("block", "Write the message first."))
        is_html = channel == "EMAIL" and looks_like_html(src_body)
        body, miss, unk = render(src_body or "", ctx, escape_html=is_html)
        if channel == "EMAIL" and not is_html:
            body = plain_to_html(body)
        if channel == "EMAIL":
            subject, miss2, unk2 = render(src_subject or "", ctx)
            miss, unk = miss + miss2, unk + unk2
            if not subject.strip():
                issues.append(issue("block", "Email subject is empty."))
        for m in sorted(set(miss)):
            issues.append(issue("block", f"No value for {{{{{m}}}}} in the database. Edit the message or fill in the data."))
        for u in sorted(set(unk)):
            issues.append(issue("block", f"Unknown variable {{{{{u}}}}}."))
        if channel == "WHATSAPP" and template and method == "TEMPLATE" and template.get("whatsapp_template_name"):
            if template.get("whatsapp_approval_status") == "APPROVED":
                for var in template.get("whatsapp_variables") or []:
                    val = ctx.get(var)
                    if not val:
                        issues.append(issue("block", f"WhatsApp template variable {{{{{var}}}}} has no value."))
                    params.append(str(val or ""))
            else:
                issues.append(issue("warn", "The Cunnekt template is not approved yet, so this goes as a free-form "
                                            "WhatsApp message (delivered only within 24 hours of the doctor's last message)."))
    else:  # AI
        if not drug:
            issues.append(issue("block", "AI drafting needs an FDA drug."))
        else:
            kegg_rows, _ = await db.select("kegg_drugs", {"drug_id": f"eq.{drug['id']}", "select": "kegg_id,indication,therapeutic_area,conflict"})
            kegg = kegg_rows[0] if kegg_rows else None
            payload = ai.facts_payload(doctor, drug, kegg, channel, campaign.get("objective"),
                                       (template or {}).get("body"), sender)
            result = await ai.generate_message(payload)
            run = (await db.insert("ai_runs", {
                "user_id": user.id, "purpose": "MESSAGE", "doctor_id": doctor["id"], "drug_id": drug["id"],
                "model": result.model, "prompt_version": ai.PROMPT_VERSION,
                "input_data_reference": {"doctor_id": doctor["id"], "drug_id": drug["id"], "channel": channel,
                                         "template_id": (template or {}).get("id"), "kegg": bool(kegg)},
                "generated_text": (result.body or result.raw or "")[:8000],
                "status": result.status, "error": result.reason if result.status != "OK" else None, "usage": result.usage,
            }, returning="id"))[0]
            ai_run_id = run["id"]
            if result.status == "FAILED":
                issues.append(issue("block", f"AI generation failed: {result.reason}"))
            else:
                body = result.body
                subject = result.subject if channel == "EMAIL" else None
                if channel == "EMAIL" and not looks_like_html(body):
                    body = plain_to_html(body)
                if result.status == "NEEDS_REVIEW":
                    issues.append(issue("block", "AI flagged this for review: " + (result.reason or "missing or contradictory data")))
                odd = fact_guard((subject or "") + " " + body, [str(v) for v in payload["fda_drug"].values() if v]
                                 + [str(v) for v in (sender or {}).values() if v] + [str(v) for v in payload["doctor"].values() if v])
                if odd:
                    issues.append(issue("block", "Contains figures not found in the FDA data: " + ", ".join(odd[:6])
                                                 + ". Edit them out or regenerate."))
                left = unresolved(body + (subject or ""))
                if left:
                    issues.append(issue("block", "Unfilled variables: " + ", ".join(left)))
                if channel == "EMAIL" and not (subject or "").strip():
                    issues.append(issue("block", "Email subject is empty."))
        if channel == "WHATSAPP":
            issues.append(issue("warn", "AI-written WhatsApp goes as a free-form message (delivered only within 24 hours "
                                        "of the doctor's last message). Use an approved Cunnekt template for cold outreach."))
    if channel == "WHATSAPP" and method == "MANUAL":
        issues.append(issue("warn", "Free-form WhatsApp is delivered only within 24 hours of the doctor's last message."))
    if drug and drug.get("review_flags"):
        for f in drug["review_flags"][:2]:
            issues.append(issue("warn", f"FDA data note: {f}"))

    return {
        "campaign_id": campaign["id"], "campaign_doctor_id": cd["id"], "doctor_id": doctor["id"],
        "department": doctor["department"], "drug_id": drug["id"] if drug else None, "channel": channel,
        "method": method, "template_id": (template or {}).get("id"), "template_version": (template or {}).get("version"),
        "ai_run_id": ai_run_id, "subject": subject, "body": body, "whatsapp_params": params,
        "status": "NEEDS_REVIEW" if blocking(issues) else "DRAFT", "issues": issues,
        "approved_by": None, "approved_at": None,
    }


async def generate(db, user: CurrentUser, campaign_id: str, limit: int = 25, manual: dict | None = None,
                   only_cd: int | None = None, budget_seconds: float = 40.0) -> dict[str, Any]:
    started = time.monotonic()
    rows, _ = await db.select("campaigns", {"id": f"eq.{campaign_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Campaign not found.")
    campaign = rows[0]
    if campaign["message_method"] == "AI":
        from ..core.config import get_settings
        if not get_settings().openrouter_api_key:
            raise HTTPException(503, "AI generation is not configured: OPENROUTER_API_KEY is missing on the server.")
    template = None
    if campaign.get("template_id"):
        t, _ = await db.select("message_templates", {"id": f"eq.{campaign['template_id']}", "select": "*"})
        template = t[0] if t else None
    sender = (await fda_settings(db)).get("sender") or {}
    params = [("campaign_id", f"eq.{campaign_id}"), ("select", "*"), ("order", "id.asc"), ("limit", str(limit))]
    params.append(("id", f"eq.{only_cd}") if only_cd else ("status", "eq.PENDING"))
    cds, _ = await db.select("campaign_doctors", params)
    doctors = {d["id"]: d for d in await _in_chunks(db, "doctors", "id", [c["doctor_id"] for c in cds], DOCTOR_COLUMNS)}
    drugs = {d["id"]: d for d in await _in_chunks(db, "fda_drugs", "id", [c["drug_id"] for c in cds], DRUG_COLUMNS)}

    made = 0
    for cd in cds:
        if time.monotonic() - started > budget_seconds:
            break
        doctor = doctors.get(cd["doctor_id"])
        if not doctor:
            continue
        drug = drugs.get(cd["drug_id"]) if cd.get("drug_id") else None
        out = []
        for ch in channels_for(campaign["channel"]):
            if not contact_for(doctor, ch):
                continue
            out.append(await _build(db, user, campaign, cd, doctor, drug, ch, template, sender, manual))
        if out:
            await db.insert("generated_messages", out, on_conflict="campaign_doctor_id,channel", resolution="merge-duplicates")
        await db.update("campaign_doctors", [("id", f"eq.{cd['id']}")], {"status": "GENERATED"})
        made += len(out)
    remaining, total = await db.select("campaign_doctors", [("campaign_id", f"eq.{campaign_id}"), ("status", "eq.PENDING"),
                                                            ("select", "id")], count=True, limit=1)
    if not total:
        await db.update("campaigns", [("id", f"eq.{campaign_id}"), ("status", "eq.DRAFT")], {"status": "REVIEW"})
    return {"generated": made, "pending": total or 0, "done": not total}


async def regenerate(db, user: CurrentUser, message: dict, manual: dict | None = None) -> dict:
    await db.update("campaign_doctors", [("id", f"eq.{message['campaign_doctor_id']}")], {"status": "PENDING"})
    await generate(db, user, message["campaign_id"], limit=1, manual=manual, only_cd=message["campaign_doctor_id"])
    rows, _ = await db.select("generated_messages", {"id": f"eq.{message['id']}", "select": "*"})
    return rows[0] if rows else {}


def recheck_edit(channel: str, subject: str | None, body: str) -> list[dict]:
    issues = []
    left = unresolved(body + " " + (subject or ""))
    if left:
        issues.append(issue("block", "Unfilled variables: " + ", ".join("{{" + x + "}}" for x in left)))
    if not body.strip():
        issues.append(issue("block", "The message is empty."))
    if channel == "EMAIL" and not (subject or "").strip():
        issues.append(issue("block", "Email subject is empty."))
    return issues


# ------------------------------------------------------------------ send
async def send_one(db, user: CurrentUser, message_id: str) -> dict[str, Any]:
    rows, _ = await db.select("generated_messages", {"id": f"eq.{message_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Message not found.")
    m = rows[0]
    if m["status"] == "SENT":
        return {"id": m["id"], "status": "SENT", "skipped": "Already sent."}
    if m["status"] != "APPROVED":
        raise HTTPException(400, "Only approved messages can be sent.")
    c, _ = await db.select("campaigns", {"id": f"eq.{m['campaign_id']}", "select": "*"})
    campaign = c[0]
    d, _ = await db.select("doctors", {"id": f"eq.{m['doctor_id']}", "select": DOCTOR_COLUMNS})
    doctor = d[0]
    drug = None
    if m.get("drug_id"):
        dr, _ = await db.select("fda_drugs", {"id": f"eq.{m['drug_id']}", "select": DRUG_COLUMNS})
        drug = dr[0] if dr else None
        if not drug or drug_sendable(drug):
            return await _fail_before_send(db, m, (drug and drug_sendable(drug)) or "FDA drug no longer available.")
    since = datetime.fromisoformat(str(campaign["created_at"]).replace("Z", "+00:00"))
    ok, until = eligibility(doctor, since=since)
    if not ok:
        return {"id": m["id"], "status": "BLOCKED", "error": f"Doctor is not eligible until {until[:10]}."}
    left = unresolved(m["body"] + " " + (m.get("subject") or ""))
    if left:
        return await _fail_before_send(db, m, "Unfilled variables: " + ", ".join(left))

    to = contact_for(doctor, m["channel"])
    if not to:
        return await _fail_before_send(db, m, "Doctor information is incomplete: no " +
                                       ("valid WhatsApp number." if m["channel"] == "WHATSAPP" else "email address."))
    sender = (await fda_settings(db)).get("sender") or {}
    template = None
    if m.get("template_id"):
        t, _ = await db.select("message_templates", {"id": f"eq.{m['template_id']}", "select": "*"})
        template = t[0] if t else None

    if m["channel"] == "WHATSAPP":
        text = m["body"]
        use_template = bool(template and template.get("whatsapp_template_name")
                            and template.get("whatsapp_approval_status") == "APPROVED" and m["method"] == "TEMPLATE")
        provider = "CUNNEKT"
    else:
        text = html_to_text(m["body"])
        provider = "SMTP"
    log = (await db.insert("message_logs", {
        "generated_message_id": m["id"], "campaign_id": m["campaign_id"], "doctor_id": m["doctor_id"],
        "department": m["department"], "drug_id": m.get("drug_id"), "channel": m["channel"],
        "template_id": m.get("template_id"), "template_version": m.get("template_version"), "recipient": to,
        "subject": m.get("subject"), "message_text": m["body"] if m["channel"] == "EMAIL" else text,
        "provider": provider, "status": "QUEUED", "created_by": user.id,
    }, returning="id"))[0]

    try:
        if m["channel"] == "WHATSAPP":
            if use_template:
                res = await whatsapp_service.send_template(to, template["whatsapp_template_name"], template.get("language") or "en",
                                                           list(m.get("whatsapp_params") or []))
            else:
                res = await whatsapp_service.send_text(to, text)
        else:
            res = await email_service.send_email(to, m.get("subject") or "", email_document(m["body"], drug, sender),
                                                 text, sender.get("name"))
    except ProviderNotConfigured as exc:
        await db.update("message_logs", [("id", f"eq.{log['id']}")],
                        {"status": "FAILED", "error": str(exc), "failed_at": now_iso()})
        await db.update("generated_messages", [("id", f"eq.{m['id']}")], {"status": "FAILED"})
        return {"id": m["id"], "status": "FAILED", "error": str(exc), "log_id": log["id"]}

    if res.ok:
        await db.update("message_logs", [("id", f"eq.{log['id']}")], {
            "status": "SENT", "provider_message_id": res.provider_message_id, "provider_response": res.response,
            "sent_at": now_iso()})
        await db.rpc("fda_record_send", {"p_log_id": log["id"]})
        await db.update("generated_messages", [("id", f"eq.{m['id']}")], {"status": "SENT"})
        return {"id": m["id"], "status": "SENT", "provider_message_id": res.provider_message_id, "log_id": log["id"]}
    await db.update("message_logs", [("id", f"eq.{log['id']}")], {
        "status": "FAILED", "provider_message_id": res.provider_message_id, "provider_response": res.response,
        "error": res.error, "failed_at": now_iso()})
    await db.update("generated_messages", [("id", f"eq.{m['id']}")], {"status": "FAILED"})
    return {"id": m["id"], "status": "FAILED", "error": res.error, "log_id": log["id"]}


async def _fail_before_send(db, m: dict, reason: str) -> dict:
    issues = list(m.get("issues") or []) + [issue("block", reason)]
    await db.update("generated_messages", [("id", f"eq.{m['id']}")], {"status": "NEEDS_REVIEW", "issues": issues,
                                                                       "approved_by": None, "approved_at": None})
    return {"id": m["id"], "status": "NOT_SENT", "error": reason}
