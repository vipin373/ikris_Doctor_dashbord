# EMA and PMDA workspaces

Sidebar **EMA** and **PMDA** work exactly like **FDA**: Drug Intelligence, Single Message, Bulk Upload,
Templates and Sent Messages. One shared pipeline (table `fda_drugs` with a `regulator` column FDA/EMA/PMDA),
so classification, the India (CDSCO) check, doctor matching by specialty, templates, campaigns, review,
WhatsApp/email sending and logs behave identically. Migration: `0021_ema_pmda_regulators.sql`.

| | EMA | PMDA |
|---|---|---|
| Source | Official EMA "Medicines" Excel (authorised human medicines) | PMDA English "List of Approved Products" PDF (new approvals + partial changes) |
| Load | Admin: **Sync from EMA** (or upload the EMA file if EMA rate-limits) | Admin: **Upload PMDA list (PDF)** — PMDA forbids automated downloads; read 30 pages per call |
| Terms | Reuse allowed with acknowledgement "Source: European Medicines Agency (EMA)" | Public Data License 1.0: cite PMDA and mark edits ("table extracted and edited by Ikris") |
| Loaded 13 Nov 2026 | 1,563 (476 not approved in India) | 2,437 (1,074 not approved in India) |

* Templates belong to one regulator (`message_templates.regulator`); a campaign can only use a template and drug of its own regulator.
  Starter templates "EMA drug update (WhatsApp)" and "PMDA drug update (WhatsApp)" reuse the approved Cunnekt template `fda_drug_update` (its text does not mention FDA).
* New variables: `{{regulator}}`, `{{regulator_name}}`, `{{approval_region}}`. `{{fda_status}}` / `{{fda_approval_date}}` hold the drug's own regulator status/date.
* AI drafts name the correct regulator and never call an EMA/PMDA approval an FDA approval. Email footers cite the right source.
* Sent-message logs carry the campaign's regulator (`message_logs.regulator`).
* FDA settings (schedule, sender) stay on the FDA page; the sender details are used by all three.
