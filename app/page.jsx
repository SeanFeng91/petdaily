import PetDailyApp from "@/components/petdaily-app";
import { getDashboardData } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getDashboardData();
  return <PetDailyApp initialData={data} />;
}
