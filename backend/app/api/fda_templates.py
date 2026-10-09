"""FDA communication templates (separate from the Google Sheet email templates at /api/templates)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from ..core.security import CurrentUser, get_current_user
from ..services.audit import audit
from ..services.campaign_service import DOCTOR_COLUMNS, fda_settings
from ..services.doctor_matcher import DRUG_COLUMNS
from ..services.message_render import (VARIABLE_NAMES, context_for, email_document, looks_like_html, plain_to_html,
                                       render, unresolved)

router = APIRouter(prefix="/api/fda/templates", tags=["fda-templates"])

Dept = Literal["ONCOLOGY", "HEMATOLOGY", "RARE_DISEASE", "NPP", "GENERAL"]
Channel = Literal["WHATSAPP", "EMAIL", "BOTH"]
TType = Literal["FDA_DRUG_UPDATE", "NEW_DRUG", "PRODUCT_INFORMATION", "AVAILABILITY", "PATIENT_ACCESS",
                "DOCTOR_FOLLOW_UP", "GENERAL", "CUSTOM"]
COLUMNS = ("id,name,department,channel,template_type,language,subject,body,status,version,whatsapp_template_name,"
           "whatsapp_template_id,whatsapp_approval_status,whatsapp_variables,created_by,updated_by,created_at,updated_at")


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    department: Dept
    channel: Channel
    template_type: TType
    language: str = Field("en", min_length=2, max_length=10)
    subject: str | None = Field(None, max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    status: Literal["DRAFT", "ACTIVE", "INACTIVE"] = "DRAFT"
    whatsapp_template_name: str | None = Field(None, max_length=200)
    whatsapp_template_id: str | None = Field(None, max_length=200)
    whatsapp_approval_status: Literal["NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED"] = "NOT_SUBMITTED"
    whatsapp_variables: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("whatsapp_variables")
    @classmethod
    def known_vars(cls, v: list[str]) -> list[str]:
        bad = [x for x in v if x not in VARIABLE_NAMES]
        if bad:
            raise ValueError(f"Unknown variables: {', '.join(bad)}")
        return v


def _check(t: TemplateIn) -> None:
    unknown = [u for u in unresolved((t.subject or "") + " " + t.body) if u not in VARIABLE_NAMES]
    if unknown:
        raise HTTPException(400, "Unknown variables: " + ", ".join("{{" + u + "}}" for u in unknown))
    if t.channel in ("EMAIL", "BOTH") and not (t.subject or "").strip():
        raise HTTPException(400, "Email templates need a subject.")
    if t.whatsapp_approval_status == "APPROVED" and not t.whatsapp_template_name:
        raise HTTPException(400, "Enter the Cunnekt template name before marking it approved.")


@router.get("")
async def list_templates(status: str | None = None, channel: str | None = None, q: str | None = None,
                         user: CurrentUser = Depends(get_current_user)):
    p = [("select", COLUMNS), ("deleted_at", "is.null"), ("order", "updated_at.desc")]
    if status in ("DRAFT", "ACTIVE", "INACTIVE"):
        p.append(("status", f"eq.{status}"))
    if channel in ("WHATSAPP", "EMAIL"):
        p.append(("channel", f"in.({channel},BOTH)"))
    if q:
        p.append(("name", f"ilike.*{q.strip()}*"))
    rows, _ = await user.db().select("message_templates", p)
    return rows


@router.get("/{template_id}")
async def get_template(template_id: str, user: CurrentUser = Depends(get_current_user)):
    rows, _ = await user.db().select("message_templates", {"id": f"eq.{template_id}", "deleted_at": "is.null", "select": COLUMNS})
    if not rows:
        raise HTTPException(404, "Template not found")
    return rows[0]


@router.post("")
async def create_template(body: TemplateIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    _check(body)
    row = (await user.db().insert("message_templates", {**body.model_dump(), "created_by": user.id, "updated_by": user.id},
                                  returning=COLUMNS))[0]
    await audit("FDA template created", user, "message_templates", row["id"], {"name": body.name}, request)
    return row


@router.put("/{template_id}")
async def update_template(template_id: str, body: TemplateIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    _check(body)
    rows = await user.db().update("message_templates", [("id", f"eq.{template_id}"), ("deleted_at", "is.null")],
                                  {**body.model_dump(), "updated_by": user.id}, returning=COLUMNS)
    if not rows:
        raise HTTPException(404, "Template not found or you cannot edit it")
    await audit("FDA template edited", user, "message_templates", template_id, {"version": rows[0]["version"]}, request)
    return rows[0]


async def _set_status(template_id: str, status: str, user: CurrentUser, request: Request):
    rows = await user.db().update("message_templates", [("id", f"eq.{template_id}"), ("deleted_at", "is.null")],
                                  {"status": status, "updated_by": user.id}, returning=COLUMNS)
    if not rows:
        raise HTTPException(404, "Template not found or you cannot edit it")
    await audit(f"FDA template {status.lower()}", user, "message_templates", template_id, None, request)
    return rows[0]


@router.post("/{template_id}/activate")
async def activate(template_id: str, request: Request, user: CurrentUser = Depends(get_current_user)):
    return await _set_status(template_id, "ACTIVE", user, request)


@router.post("/{template_id}/deactivate")
async def deactivate(template_id: str, request: Request, user: CurrentUser = Depends(get_current_user)):
    return await _set_status(template_id, "INACTIVE", user, request)


@router.post("/{template_id}/duplicate")
async def duplicate(template_id: str, request: Request, user: CurrentUser = Depends(get_current_user)):
    t = await get_template(template_id, user)
    copy = {k: t[k] for k in ("department", "channel", "template_type", "language", "subject", "body",
                              "whatsapp_template_name", "whatsapp_template_id", "whatsapp_variables")}
    copy.update({"name": f"{t['name']} (copy)"[:160], "status": "DRAFT", "whatsapp_approval_status": "NOT_SUBMITTED",
                 "created_by": user.id, "updated_by": user.id})
    row = (await user.db().insert("message_templates", copy, returning=COLUMNS))[0]
    await audit("FDA template duplicated", user, "message_templates", row["id"], {"from": template_id}, request)
    return row


@router.delete("/{template_id}")
async def delete_template(template_id: str, request: Request, user: CurrentUser = Depends(get_current_user)):
    """Soft delete: messages already sent keep their exact text and template version."""
    rows = await user.db().update("message_templates", [("id", f"eq.{template_id}"), ("deleted_at", "is.null")],
                                  {"deleted_at": datetime.now(timezone.utc).isoformat(), "status": "INACTIVE", "updated_by": user.id}, returning="id")
    if not rows:
        raise HTTPException(404, "Template not found or you cannot delete it")
    await audit("FDA template deleted", user, "message_templates", template_id, None, request)
    return {"ok": True}


@router.get("/{template_id}/versions")
async def versions(template_id: str, user: CurrentUser = Depends(get_current_user)):
    rows, _ = await user.db().select("template_versions", [("template_id", f"eq.{template_id}"), ("select", "*"),
                                                            ("order", "version.desc")])
    return rows


class PreviewIn(BaseModel):
    subject: str | None = Field(None, max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    channel: Literal["WHATSAPP", "EMAIL"]
    doctor_id: str | None = None
    drug_id: str | None = None


@router.post("/preview")
async def preview(body: PreviewIn, user: CurrentUser = Depends(get_current_user)):
    """Fills variables from a real doctor and FDA drug (no sample/fake values)."""
    db = user.db()
    doctor = drug = None
    if body.doctor_id:
        r, _ = await db.select("doctors", {"id": f"eq.{body.doctor_id}", "select": DOCTOR_COLUMNS})
        doctor = r[0] if r else None
    if body.drug_id:
        r, _ = await db.select("fda_drugs", {"id": f"eq.{body.drug_id}", "select": DRUG_COLUMNS})
        drug = r[0] if r else None
    sender = (await fda_settings(db)).get("sender") or {}
    ctx = context_for(doctor, drug, sender)
    is_html = body.channel == "EMAIL" and looks_like_html(body.body)
    text, missing, unknown = render(body.body, ctx, escape_html=is_html)
    subject, m2, u2 = render(body.subject or "", ctx)
    out = {"subject": subject if body.channel == "EMAIL" else None, "body": text,
           "missing": sorted(set(missing + m2)), "unknown": sorted(set(unknown + u2))}
    if body.channel == "EMAIL":
        out["html"] = email_document(text if is_html else plain_to_html(text), drug, sender)
    return out
