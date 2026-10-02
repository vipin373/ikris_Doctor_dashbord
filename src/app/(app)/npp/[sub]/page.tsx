"use client";
import { useParams } from "next/navigation";
import { DepartmentView } from "@/components/doctors/department-view";
export default function NppSubPage() {
  const { sub } = useParams<{ sub: string }>();
  return <DepartmentView department="NPP" subSlug={sub} />;
}
