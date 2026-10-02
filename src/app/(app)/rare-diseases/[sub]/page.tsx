"use client";
import { useParams } from "next/navigation";
import { DepartmentView } from "@/components/doctors/department-view";
export default function RareDiseaseSubPage() {
  const { sub } = useParams<{ sub: string }>();
  return <DepartmentView department="RARE_DISEASES" subSlug={sub} />;
}
