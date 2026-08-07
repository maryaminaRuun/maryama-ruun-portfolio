"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
export default function AnalyticsTracker(){const path=usePathname();useEffect(()=>{if(path.startsWith("/admin"))return;let session=localStorage.getItem("mr-session");if(!session){session=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;localStorage.setItem("mr-session",session)}fetch("/api/analytics",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path,session}),keepalive:true}).catch(()=>{})},[path]);return null}
