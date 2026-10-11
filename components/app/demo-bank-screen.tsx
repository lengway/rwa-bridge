import { ArrowDownLeft, ArrowRight, ArrowUpRight, CreditCard, Landmark, LayoutDashboard, LockKeyhole, Sparkles, Wallet } from "lucide-react";
import { DemoBadge } from "@/components/app/demo-badge";

export function DemoBankScreen({ onOpenPlain }: { onOpenPlain: () => void }) {
  return (
    <div className="min-h-dvh bg-[#f5f6f8] text-slate-900">
      <DemoBadge bank />
      <header className="border-b border-slate-200 bg-white px-5 pb-5 pt-9 sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <a href="/widget-demo" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"><span className="flex size-9 items-center justify-center rounded-xl bg-[#123b32] text-white"><Landmark className="size-5" /></span>Forma Bank</a>
          <span className="hidden items-center gap-2 text-sm text-slate-500 sm:flex"><LockKeyhole className="size-4" />Personal banking</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-7 sm:px-10 lg:grid-cols-[180px_1fr] lg:py-10">
        <aside className="hidden space-y-2 lg:block" aria-label="Bank sections">
          <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-400">Your bank</p>
          <span className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold shadow-sm"><LayoutDashboard className="size-4" />Overview</span>
          <button type="button" disabled className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400" title="Bank accounts are sample data"><Wallet className="size-4" />Accounts</button>
          <button type="button" disabled className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400" title="Card services are not connected"><CreditCard className="size-4" />Cards</button>
          <button type="button" onClick={onOpenPlain} className="mt-6 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#123b32] transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"><Sparkles className="size-4" />Plain<ArrowUpRight className="ml-auto size-4" /></button>
        </aside>
        <main className="min-w-0 space-y-7">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-sm text-slate-500">Welcome back</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Good afternoon, Alex.</h1><p className="mt-2 text-sm text-slate-500">Here&apos;s your account overview.</p></div>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold">AM</span>
          </div>
          <section aria-label="Sample bank accounts" className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Checking account</p><p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">$12,480.50</p><div className="mt-5 flex justify-between text-xs text-slate-400"><span>USD · •••• 4821</span><span>Sample account</span></div></div>
            <div className="relative overflow-hidden rounded-2xl bg-[#123b32] p-5 text-white shadow-sm"><div className="absolute -right-8 -top-10 size-40 rounded-full border border-white/10" /><p className="text-sm text-emerald-100/80">Forma debit</p><CreditCard className="absolute right-5 top-5 size-5 text-emerald-100/70" /><p className="mt-9 font-mono text-lg tracking-[0.2em]">•••• •••• •••• 4821</p><div className="mt-5 flex justify-between text-xs text-emerald-100/70"><span>ALEX MORGAN</span><span>Sample card</span></div></div>
          </section>
          <section className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-[#e8f1ec] p-6 sm:p-7">
            <div className="relative max-w-xl"><div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#39715e]"><Sparkles className="size-4" />Introducing Plain</div><h2 className="text-2xl font-semibold tracking-tight text-[#123b32] sm:text-3xl">A new way to earn with USDC.</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#48665b]">Explore lending strategies without leaving your bank. Plain opens right here, and you approve every transaction from your wallet.</p><button type="button" onClick={onOpenPlain} className="mt-6 inline-flex min-h-12 items-center gap-8 rounded-xl bg-[#123b32] px-6 text-sm font-semibold text-white transition hover:bg-[#1d5144] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2">Plain<ArrowRight className="size-4" /></button><p className="mt-3 text-xs text-[#5a766a]">Variable returns · Not a bank deposit</p></div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3"><h2 className="font-semibold">Recent activity</h2><span className="text-xs text-slate-400">Sample transactions</span></div>
            {[{ title: "Salary", date: "Oct 9", amount: "+$3,200.00", incoming: true }, { title: "Weekly groceries", date: "Oct 8", amount: "−$84.60", incoming: false }, { title: "Coffee & Co.", date: "Oct 8", amount: "−$6.50", incoming: false }].map((row) => <div key={row.title} className="flex items-center gap-3 border-t border-slate-100 py-4 first:border-t-0"><span className={`flex size-9 items-center justify-center rounded-full ${row.incoming ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{row.incoming ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{row.title}</p><p className="mt-0.5 text-xs text-slate-400">{row.date}</p></div><p className={`text-sm font-medium tabular-nums ${row.incoming ? "text-emerald-700" : "text-slate-900"}`}>{row.amount}</p></div>)}
          </section>
        </main>
      </div>
    </div>
  );
}
