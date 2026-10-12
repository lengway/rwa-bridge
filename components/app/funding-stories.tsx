"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, Wallet } from "lucide-react";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { Button } from "@/components/ui/button";

const guides = {
  add: [
    { title: "Your wallet, ready to use", text: "Open Portfolio and copy your Solana wallet address. You never need to share a private key or seed phrase.", href: "/portfolio", cta: "Open my wallet" },
    { title: "Add free USDC", text: "At Circle's faucet choose USDC and Solana Devnet, then paste your address. Other demo tokens cannot be invested as USDC.", href: "https://faucet.circle.com/", cta: "Open USDC faucet" },
    { title: "Cover the network fee", text: "Get free SOL on Solana Devnet for fees. Return to Plain, refresh your balance and choose Add to Earn.", href: "https://faucet.solana.com/", cta: "Open SOL faucet" },
  ],
  withdraw: [
    { title: "Choose what to withdraw", text: "Open Kamino Lend and choose Withdraw. Enter the USDC amount; the app checks the available amount and reserve liquidity.", href: "/earn/kamino-lend?action=withdraw", cta: "Open withdrawal" },
    { title: "Review and approve", text: "Check the amount and fee, then approve with your wallet. Do not send again while confirmation is pending.", href: "/activity", cta: "View activity" },
    { title: "Back in your wallet", text: "After verified confirmation, USDC appears in your wallet balance. This is not a bank-card payout.", href: "/portfolio", cta: "Open my wallet" },
  ],
};

export function FundingStories() {
  const [guide, setGuide] = useState<"add" | "withdraw" | null>(null);
  const [step, setStep] = useState(0);
  const slide = guide ? guides[guide][step] : null;
  return <>
    <section aria-label="Quick guides" className="grid grid-cols-2 gap-3">
      {(["add", "withdraw"] as const).map((item) => <button key={item} type="button" onClick={() => { setStep(0); setGuide(item); }} className={`group overflow-hidden rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item === "add" ? "bg-emerald-500/10" : "bg-sky-500/10"}`}><div className="mb-4 flex h-16 items-center justify-center rounded-xl bg-background/50">{item === "add" ? <ArrowDownToLine className="size-8 text-emerald-600" /> : <ArrowUpFromLine className="size-8 text-sky-600" />}</div><p className="text-sm font-semibold">{item === "add" ? "Add funds" : "Withdraw funds"}</p><p className="mt-1 text-xs text-muted-foreground">A quick visual guide →</p></button>)}
    </section>
    <DrawerFrame open={guide !== null} onOpenChange={(open) => { if (!open) setGuide(null); }} title={guide === "add" ? "Add funds" : "Withdraw funds"} description="Demo guide · no real-money payment">
      {slide && guide ? <div className="space-y-5"><div className="flex gap-2">{guides[guide].map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-foreground" : "bg-muted"}`} />)}</div><div className="flex h-36 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/15 to-sky-500/15"><Wallet className="size-16 text-foreground/70" /></div><p className="text-xs text-muted-foreground">{step + 1} / 3</p><h3 className="text-xl font-semibold">{slide.title}</h3><p className="text-sm leading-6 text-muted-foreground">{slide.text}</p>{slide.href.startsWith("https:") ? <Button className="w-full" nativeButton={false} render={<a href={slide.href} target="_blank" rel="noopener noreferrer" />}><ExternalLink />{slide.cta}</Button> : <Button className="w-full" nativeButton={false} render={<Link href={slide.href} />}>{slide.cta}</Button>}<div className="flex gap-2"><Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button><Button variant="outline" className="flex-1" onClick={() => { if (step === 2) setGuide(null); else setStep(step + 1); }}>{step === 2 ? "Done" : "Next"}</Button></div></div> : null}
    </DrawerFrame>
  </>;
}
