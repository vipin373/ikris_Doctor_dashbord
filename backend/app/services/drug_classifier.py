"""Therapeutic-area classification of FDA drugs.

Primary method is deterministic and evidence-based: the FDA label's
"Indications and Usage" text is matched against curated disease terms. Every
classification records the exact phrases it relied on. When the evidence is
weak, missing or the areas conflict without a clear lead, the drug is
NEEDS_REVIEW and is never offered for sending until a person (or the
optional OpenRouter pass, whose answer must quote the label) resolves it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

ONCOLOGY = "ONCOLOGY"
HEMATOLOGY = "HEMATOLOGY"
RARE_DISEASE = "RARE_DISEASE"
OTHER = "OTHER"
NEEDS_REVIEW = "NEEDS_REVIEW"
AREAS = (ONCOLOGY, HEMATOLOGY, RARE_DISEASE)
AREA_LABEL = {ONCOLOGY: "Oncology", HEMATOLOGY: "Hematology", RARE_DISEASE: "Rare Disease", OTHER: "Other"}
PRIORITY = {ONCOLOGY: 0, HEMATOLOGY: 1, RARE_DISEASE: 2}
AUTO_THRESHOLD = 0.75

# (term, strong). Weak terms alone are not enough evidence for an automatic class.
TERMS: dict[str, list[tuple[str, bool]]] = {
    ONCOLOGY: [
        ("cancer", True), ("carcinoma", True), ("adenocarcinoma", True), ("lymphoma", True), ("leukemia", True),
        ("leukaemia", True), ("myeloma", True), ("melanoma", True), ("sarcoma", True), ("glioblastoma", True),
        ("glioma", True), ("astrocytoma", True), ("neuroblastoma", True), ("mesothelioma", True),
        ("myelodysplastic", True), ("malignant", True), ("malignancy", True), ("malignancies", True),
        ("metastatic", True), ("solid tumor", True), ("solid tumors", True), ("carcinoid", True),
        ("blastoma", True), ("macroglobulinemia", True), ("mastocytosis", True),
        ("tumor", False), ("tumors", False), ("neoplasm", False), ("neoplasms", False), ("oncology", False),
    ],
    HEMATOLOGY: [
        ("hemophilia", True), ("haemophilia", True), ("von willebrand", True), ("thrombocytopenia", True),
        ("sickle cell", True), ("thalassemia", True), ("beta-thalassemia", True), ("neutropenia", True),
        ("paroxysmal nocturnal hemoglobinuria", True), ("hemolytic anemia", True), ("aplastic anemia", True),
        ("myelofibrosis", True), ("polycythemia vera", True), ("essential thrombocythemia", True),
        ("hemophagocytic lymphohistiocytosis", True), ("thrombotic thrombocytopenic purpura", True),
        ("deep vein thrombosis", True), ("pulmonary embolism", True), ("venous thromboembolism", True),
        ("iron deficiency anemia", True), ("anemia", True), ("anaemia", True), ("coagulation factor", True),
        ("factor viii", True), ("factor ix", True), ("hematopoietic", True), ("stem cell transplant", True),
        ("graft-versus-host", True), ("bleeding", False), ("thrombosis", False), ("hemorrhage", False),
    ],
    RARE_DISEASE: [
        ("gaucher", True), ("fabry", True), ("pompe", True), ("mucopolysaccharidosis", True), ("hunter syndrome", True),
        ("hurler", True), ("morquio", True), ("maroteaux-lamy", True), ("niemann-pick", True),
        ("acid sphingomyelinase", True), ("alpha-mannosidosis", True), ("lysosomal", True), ("cln2", True),
        ("neuronal ceroid lipofuscinosis", True), ("metachromatic leukodystrophy", True), ("adrenoleukodystrophy", True),
        ("spinal muscular atrophy", True), ("duchenne", True), ("cystic fibrosis", True),
        ("hereditary angioedema", True), ("transthyretin", True), ("amyloidosis", True), ("phenylketonuria", True),
        ("urea cycle", True), ("huntington", True), ("amyotrophic lateral sclerosis", True), ("hypophosphatasia", True),
        ("x-linked hypophosphatemia", True), ("acromegaly", True), ("cushing", True), ("wilson's disease", True),
        ("homocystinuria", True), ("tyrosinemia", True), ("neuromyelitis optica", True), ("myasthenia gravis", True),
        ("atypical hemolytic uremic syndrome", True), ("paroxysmal nocturnal hemoglobinuria", True),
        ("hemophilia", True), ("sickle cell", True), ("achondroplasia", True), ("lipodystrophy", True),
        ("porphyria", True), ("dravet", True), ("lennox-gastaut", True), ("tuberous sclerosis", True), ("rett", True),
        ("friedreich", True), ("alpha-1 antitrypsin", True), ("alpha1-antitrypsin", True), ("cystinosis", True),
        ("prader-willi", True), ("familial chylomicronemia", True), ("homozygous familial hypercholesterolemia", True),
        ("retinal dystrophy", True), ("leber", True), ("primary hyperoxaluria", True), ("idiopathic pulmonary fibrosis", True),
        ("pulmonary arterial hypertension", True), ("hemophagocytic lymphohistiocytosis", True),
        ("thrombotic thrombocytopenic purpura", True), ("osteogenesis imperfecta", True), ("gene therapy", False),
        ("rare", False), ("orphan", False),
    ],
}

CLASSIFIER_VERSION = "rules-v2"
PROMINENT_CHARS = 400  # evidence near the start of the indication is the main use, not a passing mention


def _term_regex(term: str) -> re.Pattern:
    body = r"[\s-]+".join(re.escape(part) for part in re.split(r"[\s-]+", term))
    return re.compile(r"(?<![a-z])" + body + r"(?:s|es)?(?![a-z])", re.I)


_PATTERNS = {area: [(t, strong, _term_regex(t)) for t, strong in terms] for area, terms in TERMS.items()}


@dataclass
class Classification:
    department: str
    therapeutic_areas: list[str]
    confidence: float
    reason: str
    evidence: list[str] = field(default_factory=list)
    source: str = "FDA_LABEL_RULES"
    model: str | None = None

    @property
    def review_status(self) -> str:
        return "AUTO" if self.department != NEEDS_REVIEW and self.confidence >= AUTO_THRESHOLD else "NEEDS_REVIEW"

    @property
    def therapeutic_area(self) -> str | None:
        return AREA_LABEL.get(self.department)

    def as_dict(self) -> dict:
        return {
            "department": self.department, "therapeutic_areas": self.therapeutic_areas,
            "therapeutic_area": self.therapeutic_area, "confidence": round(self.confidence, 3), "reason": self.reason,
            "evidence": self.evidence[:12], "source": self.source, "model": self.model,
            "review_status": self.review_status,
        }


def find_terms(text: str, positions: dict[str, int] | None = None) -> dict[str, list[tuple[str, bool]]]:
    """Area -> [(matched phrase as written in the label, strong)]. Optionally
    records the first position of a strong phrase per area."""
    found: dict[str, list[tuple[str, bool]]] = {}
    for area, patterns in _PATTERNS.items():
        hits: dict[str, bool] = {}
        for _term, strong, pattern in patterns:
            for m in pattern.finditer(text):
                phrase = re.sub(r"\s+", " ", m.group(0).lower())
                hits[phrase] = hits.get(phrase, False) or strong
                if strong and positions is not None:
                    positions[area] = min(positions.get(area, len(text)), m.start())
        if hits:
            found[area] = sorted(hits.items())
    return found


def classify(indication: str | None) -> Classification:
    text = (indication or "").strip()
    if len(text) < 20:
        return Classification(NEEDS_REVIEW, [], 0.0, "The FDA label has no usable Indications and Usage text.")

    first: dict[str, int] = {}
    found = find_terms(text, first)
    strong = {a: [p for p, s in hits if s] for a, hits in found.items()}
    strong_areas = [a for a in AREAS if strong.get(a)]
    weak_only = [a for a in AREAS if found.get(a) and not strong.get(a)]

    if not strong_areas:
        if weak_only:
            phrases = [p for a in weak_only for p, _ in found[a]]
            return Classification(
                NEEDS_REVIEW, weak_only, 0.5,
                "Only general terms in the FDA indication (" + ", ".join(phrases[:5]) + "); needs a person to confirm.",
                phrases,
            )
        return Classification(
            OTHER, [OTHER], 0.8,
            "The FDA indication mentions no oncology, hematology or rare-disease condition.", [],
        )

    # Primary area: most distinct strong phrases, ties broken by Oncology > Hematology > Rare Disease.
    primary = sorted(strong_areas, key=lambda a: (-len(strong[a]), PRIORITY[a]))[0]
    areas = sorted(strong_areas, key=lambda a: PRIORITY[a])
    evidence = [p for a in areas for p in strong[a]]
    prominent = len(strong[primary]) >= 2 or first.get(primary, len(text)) < PROMINENT_CHARS
    if not prominent:
        return Classification(
            NEEDS_REVIEW, areas, 0.6,
            f"Only a passing mention ({strong[primary][0]}) late in the FDA indication; a person should confirm "
            f"whether this drug is relevant to {AREA_LABEL[primary]}.", evidence,
        )
    if len(areas) == 1:
        confidence = 0.95 if len(strong[primary]) >= 2 else 0.9
        reason = f"FDA indication refers to {AREA_LABEL[primary].lower()} conditions: " + ", ".join(strong[primary][:6]) + "."
    else:
        confidence = 0.85
        reason = (f"FDA indication spans {', '.join(AREA_LABEL[a] for a in areas)}; primary area "
                  f"{AREA_LABEL[primary]} (" + ", ".join(strong[primary][:4]) + ").")
    return Classification(primary, areas, confidence, reason, evidence)


def verify_ai_classification(indication: str, answer: dict) -> Classification:
    """Accept an AI classification only when it quotes the FDA indication."""
    dept = str(answer.get("department", "")).upper().replace(" ", "_")
    if dept == "RARE":
        dept = RARE_DISEASE
    quote = str(answer.get("evidence_quote") or "").strip()
    try:
        confidence = max(0.0, min(1.0, float(answer.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0.0
    if dept not in (*AREAS, OTHER):
        return Classification(NEEDS_REVIEW, [], 0.0, "AI could not classify from the FDA data.", source="OPENROUTER")
    if not quote or quote.lower() not in (indication or "").lower():
        return Classification(NEEDS_REVIEW, [], 0.0,
                              "AI answer did not quote the FDA indication, so it was not accepted.", source="OPENROUTER")
    areas = [dept] if dept != OTHER else [OTHER]
    reason = str(answer.get("reason") or "")[:400] or "AI classification from the FDA indication."
    return Classification(dept, areas, confidence, reason, [quote[:300]], source="OPENROUTER")
