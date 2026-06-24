import { I18nText } from "@/components/I18nProvider";
import { RouteLoading } from "@/components/RouteLoading";

export default function Loading() {
  return (
    <RouteLoading
      label={<I18nText id="common.loading" />}
      title={<><I18nText id="common.loading" /> FollowBrief</>}
    />
  );
}
