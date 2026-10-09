"""Campaigns (single + bulk), message review/approval, sending, logs, analytics, provider webhooks."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..core.config import get_settings
from ..core.security import CurrentUser, get_current_user
from ..core.supabase import PostgREST, SupabaseError
from ..services import campaign_service as cs
from ..services import whatsapp_service
from ..services.audit import audit
from ..services.message_render import looks_like_html, plain_to_html

router = APIRouter(tags=["campaigns"])


class CampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    mode: Literal["SINGLE", "BULK"]
    objective: str | None = Field(None, max_length=500)
    channel: Literal["WHATSAPP", "EMAIL", "BOTH"]
    message_method: Literal["TEMPLATE", "AI", "MANUAL"]
    drug_mode: Literal["AUTO", "MANUAL"] = "AUTO"
    drug_id: str | None = None
    template_id: str | None = None
    doctor_ids: list[str] = Field(min_length=1, max_length=5000)
    upload_rows: dict[str, dict] | None = None


@router.post("/api/campaigns")
async def create_campaign(body: CampaignIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    if body.mode == "SINGLE" and len(body.doctor_ids) != 1:
        raise HTTPException(400, "A single message goes to exactly one doctor.")
    if body.mode == "BULK" and body.message_method == "MANUAL":
        raise HTTPException(400, "Bulk campaigns use a template or AI.")
    data = body.model_dump()
    if body.drug_mode == "AUTO":
        data["drug_id"] = None
    result = await cs.create_campaign(user.db(), user, data)
    await audit("Campaign created", user, "campaigns", result["campaign"]["id"],
                {"mode": body.mode, "channel": body.channel, "method": body.message_method, **result["counts"]}, request)
    return result


@router.get("/api/campaigns")
async def list_campaigns(user: CurrentUser = Depends(get_current_user), limit: int = Query(30, ge=1, le=100)):
    rows, _ = await user.db().select("campaigns", [("select", "*"), ("order", "created_at.desc"), ("limit", str(limit))])
    return rows


@router.get("/api/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    rows, _ = await db.select("campaigns", {"id": f"eq.{campaign_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Campaign not found")
    cds = await db.select_all("campaign_doctors", [
        ("campaign_id", f"eq.{campaign_id}"), ("order", "id.asc"),
        ("select", "id,doctor_id,department,drug_id,match_reason,status,skip_reason,"
                   "doctor:doctors(doctor_name,specialty,sub_department,institute,must_see),drug:fda_drugs(drug_name,fda_status,therapeutic_area)")])
    msgs = await db.select_all("generated_messages", [
        ("campaign_id", f"eq.{campaign_id}"), ("order", "created_at.asc"),
        ("select", "id,campaign_doctor_id,doctor_id,drug_id,channel,method,template_id,template_version,subject,body,"
                   "status,issues,approved_at,updated_at")])
    logs = await db.select_all("message_logs", [
        ("campaign_id", f"eq.{campaign_id}"), ("order", "id.desc"),
        ("select", "id,generated_message_id,channel,status,error,provider_message_id,sent_at,delivered_at,read_at,failed_at")])
    latest: dict[str, dict] = {}
    for lg in logs:
        latest.setdefault(lg["generated_message_id"], lg)
    for m in msgs:
        m["delivery"] = latest.get(m["id"])
    counts = {s: sum(1 for m in msgs if m["status"] == s) for s in ("DRAFT", "NEEDS_REVIEW", "APPROVED", "REJECTED", "SENT", "FAILED")}
    return {"campaign": rows[0], "doctors": cds, "messages": msgs, "counts": counts,
            "pending": sum(1 for c in cds if c["status"] == "PENDING")}


class GenerateIn(BaseModel):
    limit: int = Field(10, ge=1, le=200)
    manual_subject: str | None = Field(None, max_length=300)
    manual_body: str | None = Field(None, max_length=20000)


@router.post("/api/campaigns/{campaign_id}/generate")
async def generate(campaign_id: str, body: GenerateIn, user: CurrentUser = Depends(get_current_user)):
    manual = {"subject": body.manual_subject, "body": body.manual_body} if body.manual_body is not None else None
    return await cs.generate(user.db(), user, campaign_id, limit=body.limit, manual=manual)


class ApproveIn(BaseModel):
    message_ids: list[str] = Field(min_length=1, max_length=5000)
    action: Literal["APPROVE", "REJECT"]


@router.post("/api/campaigns/{campaign_id}/approve")
async def approve(campaign_id: str, body: ApproveIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    ids = list(dict.fromkeys(body.message_ids))
    changed = 0
    for i in range(0, len(ids), 150):
        chunk = ids[i:i + 150]
        if body.action == "APPROVE":
            rows = await db.update("generated_messages", [
                ("campaign_id", f"eq.{campaign_id}"), ("id", f"in.({','.join(chunk)})"), ("status", "in.(DRAFT,FAILED,REJECTED)")],
                {"status": "APPROVED", "approved_by": user.id, "approved_at": cs.now_iso()}, returning="id")
        else:
            rows = await db.update("generated_messages", [
                ("campaign_id", f"eq.{campaign_id}"), ("id", f"in.({','.join(chunk)})"),
                ("status", "in.(DRAFT,NEEDS_REVIEW,APPROVED,FAILED)")],
                {"status": "REJECTED", "approved_by": None, "approved_at": None}, returning="id")
        changed += len(rows)
    await audit(f"Messages {body.action.lower()}d", user, "campaigns", campaign_id, {"count": changed}, request)
    skipped = len(ids) - changed
    return {"changed": changed, "skipped": skipped,
            "note": "Messages that need review must be edited before they can be approved." if skipped and body.action == "APPROVE" else None}


class SendIn(BaseModel):
    confirm: bool
    message_ids: list[str] | None = Field(None, max_length=5000)
    limit: int = Field(20, ge=1, le=100)


@router.get("/api/campaigns/{campaign_id}/send-summary")
async def send_summary(campaign_id: str, user: CurrentUser = Depends(get_current_user)):
    rows = await user.db().select_all("generated_messages", [("campaign_id", f"eq.{campaign_id}"), ("status", "eq.APPROVED"),
                                                             ("select", "id,channel")])
    wa = sum(1 for r in rows if r["channel"] == "WHATSAPP")
    s = get_settings()
    return {"whatsapp": wa, "email": len(rows) - wa, "total": len(rows),
            "whatsapp_configured": bool(s.cunnekt_api_key), "email_configured": not s.missing_email_config,
            "email_missing": s.missing_email_config}


@router.post("/api/campaigns/{campaign_id}/send")
async def send(campaign_id: str, body: SendIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    """Sends approved messages, a batch at a time (call again while 'remaining' > 0)."""
    if not body.confirm:
        raise HTTPException(400, "Confirm sending first.")
    db = user.db()
    started = time.monotonic()
    params = [("campaign_id", f"eq.{campaign_id}"), ("status", "eq.APPROVED"), ("select", "id"), ("order", "created_at.asc")]
    if body.message_ids:
        params.append(("id", f"in.({','.join(body.message_ids[:500])})"))
    pending = await db.select_all("generated_messages", params)
    await db.update("campaigns", [("id", f"eq.{campaign_id}")], {"status": "SENDING"})
    results = []
    for m in pending[:body.limit]:
        if time.monotonic() - started > 45:
            break
        results.append(await cs.send_one(db, user, m["id"]))
    remaining = len(pending) - len(results)
    if remaining == 0:
        left = await db.select_all("generated_messages", [("campaign_id", f"eq.{campaign_id}"),
                                                          ("status", "in.(DRAFT,NEEDS_REVIEW,APPROVED)"), ("select", "id")])
        await db.update("campaigns", [("id", f"eq.{campaign_id}")], {"status": "REVIEW" if left else "COMPLETED"})
    sent = sum(1 for r in results if r["status"] == "SENT")
    await audit("Messages sent", user, "campaigns", campaign_id,
                {"sent": sent, "failed": sum(1 for r in results if r["status"] == "FAILED"), "attempted": len(results)}, request)
    return {"results": results, "sent": sent, "remaining": remaining}


# ------------------------------------------------------------------ single messages
class MessageEdit(BaseModel):
    subject: str | None = Field(None, max_length=300)
    body: str = Field(min_length=1, max_length=20000)


async def _message(db, message_id: str) -> dict:
    rows, _ = await db.select("generated_messages", {"id": f"eq.{message_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Message not found")
    return rows[0]


@router.put("/api/messages/{message_id}")
async def edit_message(message_id: str, body: MessageEdit, user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    m = await _message(db, message_id)
    if m["status"] == "SENT":
        raise HTTPException(400, "Sent messages cannot be edited.")
    text = body.body
    if m["channel"] == "EMAIL" and not looks_like_html(text):
        text = plain_to_html(text)
    issues = cs.recheck_edit(m["channel"], body.subject, text)
    keep = [i for i in (m.get("issues") or []) if i.get("level") == "warn"]
    rows = await db.update("generated_messages", [("id", f"eq.{message_id}")], {
        "subject": body.subject if m["channel"] == "EMAIL" else None, "body": text,
        "issues": keep + issues, "status": "NEEDS_REVIEW" if cs.blocking(issues) else "DRAFT",
        "approved_by": None, "approved_at": None}, returning="*")
    return rows[0]


class RegenerateIn(BaseModel):
    manual_subject: str | None = None
    manual_body: str | None = None


@router.post("/api/messages/{message_id}/regenerate")
async def regenerate(message_id: str, body: RegenerateIn | None = None, user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    m = await _message(db, message_id)
    if m["status"] == "SENT":
        raise HTTPException(400, "Sent messages cannot be regenerated.")
    manual = {"subject": body.manual_subject, "body": body.manual_body} if body and body.manual_body is not None else None
    return await cs.regenerate(db, user, m, manual)


class SendOneIn(BaseModel):
    message_id: str


@router.post("/api/whatsapp/send")
async def whatsapp_send(body: SendOneIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    m = await _message(user.db(), body.message_id)
    if m["channel"] != "WHATSAPP":
        raise HTTPException(400, "This is not a WhatsApp message.")
    res = await cs.send_one(user.db(), user, body.message_id)
    await audit("WhatsApp sent" if res["status"] == "SENT" else "WhatsApp send failed", user, "generated_messages",
                body.message_id, {"status": res["status"], "error": res.get("error")}, request)
    return res


@router.post("/api/email/send")
async def email_send(body: SendOneIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    m = await _message(user.db(), body.message_id)
    if m["channel"] != "EMAIL":
        raise HTTPException(400, "This is not an email message.")
    res = await cs.send_one(user.db(), user, body.message_id)
    await audit("Email sent" if res["status"] == "SENT" else "Email send failed", user, "generated_messages",
                body.message_id, {"status": res["status"], "error": res.get("error")}, request)
    return res


class AIGenerateIn(BaseModel):
    doctor_id: str
    drug_id: str
    channel: Literal["WHATSAPP", "EMAIL"]
    objective: str | None = Field(None, max_length=500)
    template_id: str | None = None


@router.post("/api/ai/generate-message")
async def ai_generate(body: AIGenerateIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    """Creates a single-doctor AI draft (a SINGLE campaign) and returns it for preview. Nothing is sent."""
    res = await cs.create_campaign(user.db(), user, {
        "name": "AI draft", "mode": "SINGLE", "objective": body.objective, "channel": body.channel,
        "message_method": "AI", "drug_mode": "MANUAL", "drug_id": body.drug_id, "template_id": None,
        "doctor_ids": [body.doctor_id]})
    gen = await cs.generate(user.db(), user, res["campaign"]["id"], limit=1)
    rows, _ = await user.db().select("generated_messages", {"campaign_id": f"eq.{res['campaign']['id']}", "select": "*"})
    return {"campaign_id": res["campaign"]["id"], "generated": gen, "messages": rows}


# ------------------------------------------------------------------ logs & analytics
@router.get("/api/messages")
async def message_logs(
    status: str | None = None, channel: str | None = None, doctor_id: str | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    p = [("select", "id,campaign_id,doctor_id,drug_id,channel,recipient,subject,message_text,status,error,provider,"
                    "provider_message_id,sent_at,delivered_at,read_at,failed_at,created_at,template_version,"
                    "doctor:doctors(doctor_name,institute),drug:fda_drugs(drug_name)"),
         ("order", "created_at.desc")]
    if status:
        p.append(("status", f"eq.{status}"))
    if channel in ("WHATSAPP", "EMAIL"):
        p.append(("channel", f"eq.{channel}"))
    if doctor_id:
        p.append(("doctor_id", f"eq.{doctor_id}"))
    rows, total = await user.db().select("message_logs", p, count=True, offset=(page - 1) * page_size, limit=page_size)
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size}


@router.get("/api/analytics")
async def analytics(days: int = Query(30, ge=1, le=365), user: CurrentUser = Depends(get_current_user)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    logs = await user.db().select_all("message_logs", [("created_at", f"gte.{since}"), ("select", "channel,status")])
    out: dict[str, dict[str, int]] = {"WHATSAPP": {}, "EMAIL": {}}
    for lg in logs:
        out[lg["channel"]][lg["status"]] = out[lg["channel"]].get(lg["status"], 0) + 1
    return {"days": days, "total": len(logs), "by_channel": out}


# ------------------------------------------------------------------ webhooks
@router.post("/api/webhooks/cunnekt")
async def cunnekt_webhook(request: Request, token: str = Query(..., min_length=16, max_length=200)):
    """Delivery receipts from Cunnekt. Configure in Cunnekt > API Settings with the URL shown in the FDA settings."""
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(400, "Invalid JSON")
    events = whatsapp_service.parse_webhook(payload)
    if not events:
        return {"ok": True, "events": 0}
    try:
        n = await PostgREST().rpc("fda_record_status", {"p_token": token, "p_events": events})
    except SupabaseError as exc:
        if "Invalid webhook token" in exc.message:
            raise HTTPException(401, "Invalid token")
        raise
    return {"ok": True, "events": len(events), "updated": n}
