import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = { title: 'TypeSafe AI Benchmark — Qwen vs. Jev', description: 'Compare LLM-native structured output from Qwen 3.8 on Cerebras with TypeSafe Jev across seven workloads: latency, cost and judgment quality.' };
export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
