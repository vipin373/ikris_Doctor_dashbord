"use client";

import * as React from "react";

export type RegulatorCode = "FDA" | "EMA" | "PMDA";

export interface RegulatorInfo {
  code: RegulatorCode;
  short: string;
  title: string;
  authority: string;
  region: string;
  /** e.g. "FDA status" */
  statusLabel: string;
  /** e.g. "FDA approval" / "EU authorisation" */
  approvalLabel: string;
  recordLink: string;
  labelLink: string;
  sourceLink: string;
  numberHint: string;
  templateType: string;
  subjectExample: string;
  pageDescription: string;
  sourceNote: string;
}

export const REGULATORS: Record<RegulatorCode, RegulatorInfo> = {
  FDA: {
    code: "FDA", short: "FDA", title: "FDA", authority: "U.S. Food and Drug Administration", region: "USA",
    statusLabel: "FDA status", approvalLabel: "FDA approval", recordLink: "View FDA Source (Drugs@FDA)", labelLink: "FDA label (DailyMed)",
    sourceLink: "openFDA record", numberHint: "NDA/BLA", templateType: "FDA_DRUG_UPDATE",
    subjectExample: "FDA Drug Information Update – {{drug_name}}",
    pageDescription: "FDA drug intelligence and doctor communication. Drug facts come from openFDA; every message is previewed and approved before it is sent.",
    sourceNote: "openFDA (US Government public data).",
  },
  EMA: {
    code: "EMA", short: "EMA", title: "EMA", authority: "European Medicines Agency", region: "European Union",
    statusLabel: "EMA status", approvalLabel: "EU authorisation", recordLink: "View EMA medicine page (EPAR)", labelLink: "EMA product information",
    sourceLink: "EMA data download page", numberHint: "EMEA/H/C number", templateType: "EMA_DRUG_UPDATE",
    subjectExample: "EU (EMA) Medicine Information Update – {{drug_name}}",
    pageDescription: "EU medicines authorised through the EMA, matched to your doctors. Drug facts come from the official EMA medicines data; every message is previewed and approved before it is sent.",
    sourceNote: "Source: European Medicines Agency (EMA). EU authorisation is not proof of marketing in every EU country.",
  },
  PMDA: {
    code: "PMDA", short: "PMDA", title: "PMDA", authority: "Pharmaceuticals and Medical Devices Agency (Japan)", region: "Japan",
    statusLabel: "PMDA status", approvalLabel: "Japan approval", recordLink: "PMDA list of approved products", labelLink: "PMDA review reports",
    sourceLink: "PMDA source page", numberHint: "PMDA record", templateType: "PMDA_DRUG_UPDATE",
    subjectExample: "Japan (PMDA) Medicine Information Update – {{drug_name}}",
    pageDescription: "Medicines approved in Japan (PMDA / MHLW), matched to your doctors. Drug facts come from PMDA's English list of approved products; every message is previewed and approved before it is sent.",
    sourceNote: "Source: PMDA, List of Approved Products (English); table extracted and edited by Ikris.",
  },
};

const Ctx = React.createContext<RegulatorInfo>(REGULATORS.FDA);

export function RegulatorProvider({ code, children }: { code: RegulatorCode; children: React.ReactNode }) {
  return <Ctx.Provider value={REGULATORS[code]}>{children}</Ctx.Provider>;
}

/** The regulator of the current workspace (FDA, EMA or PMDA). Defaults to FDA. */
export function useRegulator(): RegulatorInfo {
  return React.useContext(Ctx);
}
