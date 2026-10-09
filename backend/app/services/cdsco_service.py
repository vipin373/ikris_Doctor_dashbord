"""India (CDSCO) approval check for FDA drugs.

Source: CDSCO "List of New Drugs approved" PDFs
(https://cdsco.gov.in/opencms/opencms/en/Approval_new/Approved-New-Drugs/).
The PDFs are downloaded, their text is turned into a word index
(cdsco_terms), and the database function fda_match_india marks each drug:

- APPROVED   every active ingredient name appears in the CDSCO lists
- NOT_FOUND  none appears (shown in the dashboard as "not approved in India")
- UNKNOWN    the ingredient can't be matched reliably, or only part of a combination
             appears -> a person decides (MANUAL_APPROVED / MANUAL_NOT_APPROVED)

Manual decisions are never overwritten. Absence from the lists is strong
evidence but not proof: the lists cover "new drugs" from 1961 onward and some
older PDFs are scanned images without text.
"""

from __future__ import annotations

import hashlib
import io
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

LIST_PAGE = "https://cdsco.gov.in/opencms/opencms/en/Approval_new/Approved-New-Drugs/"
LINK_RE = re.compile(r'href="([^"]*download_file_division\.jsp\?num_id=[^"]+)"', re.I)

SALT_WORDS = {
    "hydrochloride", "dihydrochloride", "hcl", "sodium", "disodium", "potassium", "calcium", "magnesium", "mesylate",
    "dimesylate", "maleate", "citrate", "sulfate", "sulphate", "phosphate", "diphosphate", "acetate", "tartrate",
    "bitartrate", "besylate", "besilate", "tosylate", "fumarate", "hemifumarate", "succinate", "malate", "lactate",
    "gluconate", "meglumine", "dimeglumine", "tromethamine", "bromide", "chloride", "hydrobromide", "hydrate",
    "monohydrate", "dihydrate", "trihydrate", "sesquihydrate", "anhydrous", "dimethyl", "sulfoxide", "ethanolate",
    "free", "base", "acid", "esylate", "camsylate", "napsylate", "oxalate", "benzoate", "propionate", "valerate",
    "dipropionate", "palmitate", "pamoate", "stearate", "nitrate", "carbonate", "bicarbonate", "trifluoroacetate",
    "hemisulfate", "edisylate", "olamine", "injection", "recombinant", "liposome", "liposomal", "protein", "bound",
    "particles", "albumin", "human", "kit", "for", "of", "and", "with", "in", "usp", "eq",
}
# Words that make a name too vague to match safely against the lists.
VAGUE = {"factor", "coagulation", "immune", "globulin", "insulin", "vaccine", "antihemophilic", "complex",
         "concentrate", "plasma", "derived", "fragment", "conjugate", "toxin", "cells", "cell", "virus", "extract"}
TOKEN_RE = re.compile(r"[a-z]{3,}")


def tokens(text: str) -> set[str]:
    # join words broken across lines ("trame-\ntinib")
    t = re.sub(r"-\s*\n\s*", "", text.lower())
    return set(TOKEN_RE.findall(t))


def ingredient_keys(active_ingredient: str | None, generic_name: str | None = None) -> tuple[list[str], str | None]:
    """Names (space-separated words) to look up, or ([], reason) when not reliably matchable."""
    raw = active_ingredient or generic_name or ""
    parts = [p for p in re.split(r";|,|\band\b|/|\+", raw, flags=re.I) if p.strip()]
    names: list[str] = []
    for part in parts:
        words = []
        for w in re.findall(r"[a-z]+(?:-[a-z]+)*", part.lower()):
            w = re.sub(r"-[a-z]{4}$", "", w)  # biosimilar suffix: denosumab-kyqq
            for piece in w.split("-"):
                if piece and piece not in SALT_WORDS:
                    words.append(piece)
        if not words:
            continue
        if any(w in VAGUE for w in words):
            return [], f"“{part.strip()}” is not a single drug name the CDSCO lists use; check manually."
        name = " ".join(words)
        if len(name.replace(" ", "")) < 6:
            return [], f"“{part.strip()}” is too short to match safely; check manually."
        names.append(name)
    if not names:
        return [], "No active ingredient name in the FDA record; check manually."
    return sorted(set(names)), None


async def list_documents(client: httpx.AsyncClient) -> list[dict[str, str]]:
    resp = await client.get(LIST_PAGE)
    resp.raise_for_status()
    html = resp.text
    docs: list[dict[str, str]] = []
    for m in LINK_RE.finditer(html):
        href = m.group(1).replace("&amp;", "&")
        if href.startswith("/"):
            href = "https://cdsco.gov.in" + href
        start = html.rfind("<tr", 0, m.start())
        row = html[start:m.start()] if start != -1 else ""
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        title = next((c for c in cells if len(c) > 8 and not c.isdigit()), "") or "CDSCO list of new drugs"
        if href not in {d["url"] for d in docs}:
            docs.append({"url": href, "title": title[:300]})
    return docs


def pdf_text(data: bytes) -> tuple[str, int, int]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    texts, with_text = [], 0
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if len(t.strip()) > 30:
            with_text += 1
        texts.append(t)
    return "\n".join(texts), len(reader.pages), with_text


async def fetch_documents(db, budget_seconds: float = 38.0) -> dict[str, Any]:
    """Downloads CDSCO list PDFs that are new or changed and indexes their words. Resumable."""
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True,
                                 headers={"User-Agent": "Mozilla/5.0 (IKRIS Doctor Connect)"}) as client:
        docs = await list_documents(client)
        have, _ = await db.select("cdsco_documents", {"select": "id,url,sha256,fetched_at,error"})
        known = {h["url"]: h for h in have}
        today = datetime.now(timezone.utc)

        def stale(d: dict) -> bool:
            k = known.get(d["url"])
            if not k or k.get("error") or not k.get("sha256"):
                return True
            # the "till date" lists keep growing: re-check them after a day
            if re.search(r"till date|to date", d["title"], re.I) and k.get("fetched_at"):
                return (today - datetime.fromisoformat(k["fetched_at"].replace("Z", "+00:00"))).days >= 1
            return False

        todo = [d for d in docs if stale(d)]
        done, errors, indexed = 0, [], 0
        for d in todo:
            if time.monotonic() - started > budget_seconds:
                break
            now = datetime.now(timezone.utc).isoformat()
            try:
                r = await client.get(d["url"])
                r.raise_for_status()
                data = r.content
                if not data.startswith(b"%PDF"):
                    raise ValueError("CDSCO returned a page instead of a PDF")
                sha = hashlib.sha256(data).hexdigest()
                if known.get(d["url"], {}).get("sha256") == sha:
                    await db.update("cdsco_documents", [("url", f"eq.{d['url']}")], {"fetched_at": now})
                    done += 1
                    continue
                text, pages, text_pages = pdf_text(data)
                row = (await db.insert("cdsco_documents", {
                    "title": d["title"], "url": d["url"], "text": text, "pages": pages, "text_pages": text_pages,
                    "sha256": sha, "error": None, "fetched_at": now,
                }, on_conflict="url", resolution="merge-duplicates", returning="id"))[0]
                await db.delete("cdsco_terms", [("doc_id", f"eq.{row['id']}")])
                terms = sorted(tokens(text))
                for i in range(0, len(terms), 2000):
                    await db.insert("cdsco_terms", [{"term": t, "doc_id": row["id"]} for t in terms[i:i + 2000]],
                                    on_conflict="term,doc_id", resolution="ignore-duplicates")
                indexed += 1
            except Exception as exc:
                errors.append(f"{d['title']}: {exc}"[:300])
                await db.insert("cdsco_documents", {"title": d["title"], "url": d["url"], "error": str(exc)[:300],
                                                    "fetched_at": now}, on_conflict="url", resolution="merge-duplicates")
            done += 1
    return {"documents_listed": len(docs), "processed": done, "indexed": indexed,
            "remaining": max(0, len(todo) - done), "errors": errors[:5]}


async def backfill_keys(rpc, drugs: list[dict[str, Any]]) -> int:
    rows = []
    for d in drugs:
        keys, problem = ingredient_keys(d.get("active_ingredient"), d.get("generic_name"))
        rows.append({"application_number": d["application_number"], "keys": keys, "problem": problem})
    n = 0
    for i in range(0, len(rows), 300):
        n += int(await rpc("fda_set_india_keys", rows[i:i + 300]) or 0)
    return n
