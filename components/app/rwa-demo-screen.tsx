"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RwaDemoLauncher } from "@/components/app/rwa-demo-drawer";
import { useDevnet } from "@/lib/useDevnet";

/**
 * A deliberately separate screen: RWA-DEMO must never inherit the real-asset
 * language used by the existing OFFICE flow.
 */
export function RwaDemoScreen() {
  const devnet = useDevnet();

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">ДЕМО</Badge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            RWA-DEMO
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Цифровая доля в демонстрационном портфеле. Выберите сумму, проверьте
            условия и подтвердите покупку.
          </p>
        </div>
      </section>

      <Card className="gap-3 rounded-2xl p-4">
        <p className="text-sm font-medium">Как это работает</p>
        <ol className="grid gap-3 text-xs leading-5 text-muted-foreground sm:grid-cols-3">
          <li>
            <span className="font-medium text-foreground">1. Выберите сумму.</span>{" "}
            Укажите, сколько USDC использовать для покупки.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Проверьте условия.</span>{" "}
            До подтверждения увидите точный результат операции.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Подтвердите.</span>{" "}
            Кошелёк попросит подтвердить демонстрационную операцию.
          </li>
        </ol>
      </Card>

      <p className="text-center text-xs leading-5 text-muted-foreground">
        {devnet.walletAddress
          ? "Демо-среда: операция использует тестовые средства и не создаёт прав на реальный актив."
          : "Войдите в приложение, чтобы продолжить в демонстрационном режиме."}
      </p>

      <RwaDemoLauncher onTradeConfirmed={() => void devnet.refreshPortfolio()} />
    </div>
  );
}
