"use client";
import { useEffect } from "react";
import { useToteflow } from "@/lib/store";

export default function StreamProvider() {
  const connect = useToteflow(s => s._connect);
  const disconnect = useToteflow(s => s._disconnect);
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);
  return null;
}
