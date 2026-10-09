"""SMTP email. "Sent" means the SMTP server accepted the message; SMTP gives
no delivery or read receipts, so those statuses are never shown for email."""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, parseaddr

from ..core.config import get_settings
from .whatsapp_service import ProviderNotConfigured, ProviderResult


def _send_sync(to: str, subject: str, html_body: str, text_body: str, from_name: str | None) -> ProviderResult:
    s = get_settings()
    msg = EmailMessage()
    name, addr = parseaddr(s.email_from)
    msg["From"] = formataddr((from_name or name or "Ikris Pharma Network", addr or s.email_from))
    msg["To"] = to
    msg["Subject"] = subject
    msg_id = make_msgid(domain=(addr or s.email_from).split("@")[-1] or None)
    msg["Message-ID"] = msg_id
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    try:
        if s.smtp_port == 465:
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ssl.create_default_context(), timeout=25) as smtp:
                smtp.login(s.smtp_user, s.smtp_password)
                refused = smtp.send_message(msg)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=25) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(s.smtp_user, s.smtp_password)
                refused = smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        return ProviderResult(False, None, f"{type(exc).__name__}: {exc}"[:500], {})
    if refused:
        return ProviderResult(False, msg_id, f"Recipient refused: {refused}"[:500], {"refused": str(refused)})
    return ProviderResult(True, msg_id, None, {"accepted_by": s.smtp_host})


async def send_email(to: str, subject: str, html_body: str, text_body: str, from_name: str | None = None) -> ProviderResult:
    missing = get_settings().missing_email_config
    if missing:
        raise ProviderNotConfigured("Email is not configured on the server. Missing: " + ", ".join(missing))
    return await asyncio.to_thread(_send_sync, to, subject, html_body, text_body, from_name)
