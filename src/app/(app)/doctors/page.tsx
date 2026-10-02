"use client";

import { DoctorDirectory } from "@/components/doctors/doctor-directory";
import { PageHeader } from "@/components/ui/misc";
import { useAuth } from "@/components/auth-provider";

export default function DoctorsPage() {
  const { me } = useAuth();
  return (
    <div>
      <PageHeader
        title="Doctors"
        description={me?.role === "ADMIN" ? "All NPP and Rare Disease doctors, synced from Google Sheets." : "Doctors in your department, synced from Google Sheets."}
      />
      <DoctorDirectory />
    </div>
  );
}
