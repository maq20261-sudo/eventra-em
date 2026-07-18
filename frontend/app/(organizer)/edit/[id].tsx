import { useLocalSearchParams } from "expo-router";
import EventForm from "@/src/EventForm";

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EventForm editId={String(id)} />;
}
