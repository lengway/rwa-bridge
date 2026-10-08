"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  BadgePercent,
  Bell,
  BriefcaseBusiness,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  CreditCard,
  FileText,
  Gift,
  Home,
  Landmark,
  Laptop,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Plane,
  QrCode,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatApy, formatMoney } from "@/lib/format";
import { useMarketData } from "@/lib/useMarketData";
import { toast } from "sonner";

type PaymentRequest = {
  id: string;
  amountUsd: number;
  amountKzt: number;
  description: string;
  status: "confirm" | "processing" | "success";
};

const services = [
  { label: "Магазин", icon: ShoppingBag },
  { label: "Мой банк", icon: CreditCard },
  { label: "Платежи", icon: FileText },
  { label: "Переводы", icon: ArrowLeftRight },
  { label: "Маркет", icon: Gift },
  { label: "Travel", icon: Plane },
  { label: "Госуслуги", icon: Landmark },
];

const shortcuts = [
  { title: "Рассрочка", subtitle: "Покупки частями", icon: CreditCard, color: "bg-rose-50 text-rose-600" },
  { title: "Кредит наличными", subtitle: "Решение онлайн", icon: ArrowDownLeft, color: "bg-orange-50 text-orange-600" },
  { title: "Стать самозанятым", subtitle: "Регистрация онлайн", icon: BriefcaseBusiness, color: "bg-blue-50 text-blue-600" },
  { title: "Депозит", subtitle: "Сбережения на каждый день", icon: Landmark, color: "bg-emerald-50 text-emerald-600" },
];

const recentProducts = [
  { title: "Квартира-студия", price: "18 500 000 ₸", tone: "from-orange-100 via-rose-100 to-amber-50", icon: Home },
  { title: "Ноутбук", price: "449 990 ₸", tone: "from-sky-100 via-indigo-50 to-blue-50", icon: Laptop },
  { title: "Путешествие", price: "от 680 000 ₸", tone: "from-violet-100 via-fuchsia-50 to-pink-50", icon: Plane },
  { title: "Домашняя техника", price: "от 89 990 ₸", tone: "from-lime-100 via-emerald-50 to-teal-50", icon: ShoppingBag },
];

function formatTenge(amount: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.max(0, amount))} ₸`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function DemoBankScreen() {
  const marketData = useMarketData();
  const [investmentOpen, setInvestmentOpen] = useState(false);
  const [bankBalanceKzt, setBankBalanceKzt] = useState(1_250_000);
  const [payment, setPayment] = useState<PaymentRequest | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const slides = [
    { title: "Доход на долларах", detail: `от ${formatApy(marketData.yields.usdy.apy)} годовых`, tag: "Новое", tone: "from-[#e5352b] via-[#f04b3f] to-[#ff866c]", icon: Sparkles },
    { title: "Кэшбэк до 10%", detail: "Больше пользы в каждом дне", tag: "Предложение", tone: "from-[#ffbd71] via-[#ff9a72] to-[#f77373]", icon: BadgePercent },
    { title: "Переводы без комиссии", detail: "Отправляйте близким удобно", tag: "Для вас", tone: "from-[#777de8] via-[#8e8bed] to-[#b9a0f4]", icon: ArrowLeftRight },
  ];

  const showUnavailable = useCallback(() => toast("Недоступно в демо"), []);
  const openInvestments = useCallback(() => setInvestmentOpen(true), []);

  const sendPaymentResult = useCallback((id: string, status: "paid" | "cancelled") => {
    iframeRef.current?.contentWindow?.postMessage({
      type: "rwa-bridge:payment-result",
      id,
      status,
    }, window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (!isRecord(event.data) || event.data.type !== "rwa-bridge:payment-request") return;
      const { id, amountUsd, amountKzt, description } = event.data;
      if (
        typeof id !== "string"
        || !id.trim()
        || id.length > 128
        || typeof amountUsd !== "number"
        || !Number.isFinite(amountUsd)
        || amountUsd < 1
        || amountUsd > 1_000
      ) return;

      const calculatedKzt = amountUsd * marketData.rate.usdKzt;
      setPayment({
        id,
        amountUsd,
        amountKzt: typeof amountKzt === "number" && Number.isFinite(amountKzt) && amountKzt > 0
          ? amountKzt
          : calculatedKzt,
        description: typeof description === "string" ? description : "Пополнение баланса RWA Bridge",
        status: "confirm",
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [marketData.rate.usdKzt]);

  useEffect(() => {
    if (payment?.status !== "processing") return;
    const currentPayment = payment;
    const timer = window.setTimeout(() => {
      setBankBalanceKzt((balance) => Math.max(0, balance - currentPayment.amountKzt));
      sendPaymentResult(currentPayment.id, "paid");
      setPayment((current) => current?.id === currentPayment.id
        ? { ...current, status: "success" }
        : current);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [payment, sendPaymentResult]);

  const closePayment = useCallback(() => {
    if (!payment || payment.status === "processing") return;
    if (payment.status === "confirm") sendPaymentResult(payment.id, "cancelled");
    setPayment(null);
  }, [payment, sendPaymentResult]);

  const onCarouselScroll = () => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const slideWidth = carousel.clientWidth - 32 + 12;
    setActiveSlide(Math.min(slides.length - 1, Math.max(0, Math.round(carousel.scrollLeft / slideWidth))));
  };

  const goToSlide = (index: number) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    carousel.scrollTo({ left: index * (carousel.clientWidth - 32 + 12), behavior: "smooth" });
    setActiveSlide(index);
  };

  return (
    <main className="min-h-dvh bg-[#f2f3f5] md:flex md:items-center md:justify-center md:p-6">
      <section style={{ colorScheme: "light", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }} className="relative mx-auto flex h-dvh min-h-dvh w-full max-w-[420px] flex-col overflow-hidden bg-white text-[#202124] [--bank-accent:#e5352b] md:h-[min(900px,calc(100dvh-3rem))] md:min-h-[680px] md:rounded-[30px] md:border md:border-black/5 md:shadow-[0_24px_80px_rgba(20,20,28,0.18)]">
        <header className="sticky top-0 z-20 shrink-0 border-b border-[#eeeeef] bg-white/95 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] backdrop-blur">
          <div className="mb-3 flex justify-center">
            <span className="rounded-full bg-[#fff1ef] px-3 py-1 text-[10px] font-semibold tracking-[0.01em] text-[#b12f27]">
              Тестовый экран · вымышленный банк
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#f4f5f6] px-3 text-[#777b82]">
              <Search className="size-[18px] shrink-0" />
              <input aria-label="Поиск по Демо-банку" placeholder="Поиск по Демо-банку" className="min-w-0 flex-1 bg-transparent text-sm text-[#292b2f] outline-none placeholder:text-[#8c9097]" />
              <button type="button" aria-label="Камера" onClick={showUnavailable} className="grid size-7 shrink-0 place-items-center rounded-lg text-[#60646b] hover:bg-black/5">
                <Camera className="size-[18px]" />
              </button>
            </label>
            <button type="button" aria-label="Корзина" onClick={showUnavailable} className="grid size-11 shrink-0 place-items-center rounded-xl text-[#303238] hover:bg-[#f4f5f6]">
              <ShoppingCart className="size-[21px]" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <section aria-label="Предложения" className="pt-4">
            <div ref={carouselRef} onScroll={onCarouselScroll} className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 scrollbar-none">
              {slides.map(({ title, detail, tag, tone, icon: Icon }, index) => (
                <button
                  type="button"
                  key={title}
                  onClick={index === 0 ? openInvestments : showUnavailable}
                  className={`relative flex min-h-[142px] w-full shrink-0 snap-start flex-col items-start justify-between overflow-hidden rounded-2xl bg-gradient-to-br ${tone} p-4 text-left text-white shadow-sm`}
                >
                  <span className="absolute -right-5 -top-7 size-32 rounded-full border-[18px] border-white/10" />
                  <span className="absolute -right-2 bottom-[-42px] size-28 rounded-full bg-white/10" />
                  <span className="relative flex w-full items-start justify-between">
                    <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-semibold backdrop-blur-sm">{tag}</span>
                    <Icon className="size-5 opacity-90" />
                  </span>
                  <span className="relative block">
                    <span className="block text-[19px] font-semibold tracking-tight">{title}</span>
                    <span className="mt-1 block text-xs text-white/90">{detail}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-center gap-1.5" aria-label="Слайды предложений">
              {slides.map((slide, index) => (
                <button
                  type="button"
                  key={slide.title}
                  aria-label={`Слайд ${index + 1}`}
                  aria-current={activeSlide === index ? "true" : undefined}
                  onClick={() => goToSlide(index)}
                  className={`h-1.5 rounded-full transition-all ${activeSlide === index ? "w-5 bg-[#e5352b]" : "w-1.5 bg-[#d5d6d9]"}`}
                />
              ))}
            </div>
          </section>

          <section className="mx-4 mt-4 flex items-center justify-between rounded-2xl border border-[#f0f0f1] bg-[#fffdfd] px-4 py-3" aria-label="Баланс демо-карты">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff0ee] text-[#e5352b]"><CreditCard className="size-5" /></span>
              <span className="min-w-0">
                <span className="block text-xs text-[#858990]">Демо-карта ·· 4821</span>
                <span className="mt-0.5 block truncate text-lg font-semibold tabular-nums">{formatTenge(bankBalanceKzt)}</span>
              </span>
            </div>
            <span className="ml-2 shrink-0 text-[10px] font-medium text-[#999da3]">Доступно</span>
          </section>

          <section className="px-4 pt-5" aria-label="Сервисы">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold tracking-tight">Сервисы</h2>
              <button type="button" onClick={showUnavailable} aria-label="Все сервисы" className="text-xs font-medium text-[#777b82]">Все <ChevronRight className="ml-0.5 inline size-3.5" /></button>
            </div>
            <div className="grid grid-cols-4 gap-x-1 gap-y-4">
              {services.map(({ label, icon: Icon }) => (
                <ServiceTile key={label} label={label} icon={Icon} onClick={showUnavailable} />
              ))}
              <ServiceTile label="Инвестиции" icon={Sparkles} active onClick={openInvestments} />
            </div>
          </section>

          <section className="px-4 pt-5" aria-label="Партнёры">
            <h2 className="mb-3 text-[17px] font-semibold tracking-tight">Партнёры</h2>
            <button type="button" onClick={openInvestments} className="flex w-full items-center gap-3 rounded-2xl border border-[#eeeeef] bg-white p-3.5 text-left shadow-[0_2px_8px_rgba(20,20,28,0.03)] transition hover:bg-[#fffafa]">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#fff0ee] text-[#e5352b]"><span className="text-xs font-extrabold tracking-tight">RWA</span></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">RWA Bridge</span>
                <span className="mt-1 block text-xs leading-4 text-[#83878e]">Доход на долларах и доли в недвижимости</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-[#92969d]" />
            </button>
          </section>

          <section className="px-4 pt-5" aria-label="Финансовые продукты">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold tracking-tight">Вам может подойти</h2>
              <button type="button" onClick={showUnavailable} aria-label="Другие продукты" className="grid size-7 place-items-center rounded-full text-[#898d94]"><CircleHelp className="size-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {shortcuts.map(({ title, subtitle, icon: Icon, color }) => (
                <button type="button" key={title} onClick={showUnavailable} className="flex min-h-[106px] flex-col items-start justify-between rounded-2xl border border-[#eeeeef] bg-white p-3 text-left transition hover:bg-[#fafafa]">
                  <span className={`grid size-9 place-items-center rounded-xl ${color}`}><Icon className="size-[18px]" /></span>
                  <span>
                    <span className="block text-[13px] font-semibold leading-4">{title}</span>
                    <span className="mt-1 block text-[10px] leading-3.5 text-[#8b8f96]">{subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="pt-5" aria-label="Недавно просмотренные">
            <div className="mb-3 flex items-center justify-between px-4">
              <h2 className="text-[17px] font-semibold tracking-tight">Вы недавно смотрели</h2>
              <button type="button" onClick={showUnavailable} className="text-xs text-[#898d94]">Все</button>
            </div>
            <div className="flex gap-3 overflow-x-auto px-4 pb-1 scrollbar-none">
              {recentProducts.map(({ title, price, tone, icon: ProductIcon }) => (
                <button type="button" key={title} onClick={showUnavailable} className="w-[142px] shrink-0 text-left">
                  <span className={`relative flex h-[105px] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ${tone}`}>
                    <span className="absolute -right-3 -top-4 size-16 rounded-full bg-white/35" />
                    <span className="absolute bottom-[-22px] left-2 size-20 rounded-full bg-white/40" />
                    <ProductIcon className="relative size-9 text-[#555966]/70" strokeWidth={1.5} />
                  </span>
                  <span className="mt-2 block truncate text-xs font-medium">{title}</span>
                  <span className="mt-1 block text-xs text-[#777b82]">{price}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="px-4 pb-4 pt-5">
            <button type="button" onClick={showUnavailable} className="flex w-full items-center gap-3 rounded-2xl bg-[#f7f7f8] p-3 text-left">
              <span className="grid size-9 place-items-center rounded-xl bg-white text-[#777b82]"><Bell className="size-4" /></span>
              <span className="flex-1 text-xs leading-4 text-[#777b82]">Настройте уведомления и будьте в курсе операций</span>
              <ChevronRight className="size-4 text-[#92969d]" />
            </button>
          </div>
        </div>

        <nav aria-label="Нижняя навигация" className="absolute inset-x-0 bottom-0 z-20 border-t border-[#ededee] bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur">
          <div className="grid grid-cols-4">
            <BottomTab label="Главная" icon={Home} active onClick={() => undefined} />
            <BottomTab label="QR" icon={QrCode} onClick={showUnavailable} />
            <BottomTab label="Сообщения" icon={MessageCircle} badge onClick={showUnavailable} />
            <BottomTab label="Сервисы" icon={MapPin} onClick={showUnavailable} />
          </div>
        </nav>
      </section>

      <Sheet open={investmentOpen} onOpenChange={setInvestmentOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="data-[side=bottom]:h-dvh max-h-dvh gap-0 rounded-none bg-white p-0 text-[#202124]">
          <SheetHeader className="flex-row items-center border-b border-[#eeeeef] bg-white px-4 py-3 text-left text-[#202124]">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-sm font-semibold">Инвестиции · RWA Bridge</SheetTitle>
              <SheetDescription className="text-xs text-[#898d94]">Доход на долларах и доли в недвижимости</SheetDescription>
            </div>
            <Button variant="ghost" size="icon" aria-label="Закрыть" onClick={() => setInvestmentOpen(false)} className="text-[#44474d] hover:bg-[#f4f5f6]">
              <X />
            </Button>
          </SheetHeader>
          <iframe ref={iframeRef} src="/home?embed=bank" title="RWA Bridge внутри Демо-банка" className="min-h-0 w-full flex-1 border-0 bg-white" />
        </SheetContent>
      </Sheet>

      <Sheet open={payment !== null} onOpenChange={(open) => { if (!open) closePayment(); }}>
        <SheetContent side="bottom" showCloseButton={false} className="data-[side=bottom]:h-auto max-h-[94dvh] gap-0 rounded-t-[28px] border-0 bg-white p-0 text-[#202124]">
          {payment ? (
            <div className="mx-auto w-full max-w-[520px] px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-2">
              <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[#d9dade]" />
              <SheetHeader className="relative p-0 text-left">
                <SheetTitle className="text-center text-[19px] font-semibold">{payment.status === "success" ? "Оплачено" : "Подтверждение оплаты"}</SheetTitle>
                <SheetDescription className="sr-only">Оплата в демонстрационном режиме</SheetDescription>
                {payment.status !== "processing" ? (
                  <button type="button" onClick={closePayment} aria-label="Закрыть подтверждение" className="absolute right-0 top-0 grid size-8 place-items-center rounded-full bg-[#f4f5f6] text-[#60646b]">
                    <X className="size-4" />
                  </button>
                ) : null}
              </SheetHeader>

              {payment.status === "success" ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <span className="grid size-[62px] place-items-center rounded-full bg-[#e9f8ef] text-[#18864b]"><Check className="size-8" /></span>
                  <p className="text-[34px] font-semibold tracking-tight tabular-nums">{formatTenge(payment.amountKzt)}</p>
                  <p className="text-sm text-[#777b82]">Пополнение RWA Bridge подтверждено</p>
                  <p className="text-xs text-[#858990]">Новый баланс карты: {formatTenge(bankBalanceKzt)}</p>
                  <Button className="mt-3 h-11 w-full rounded-xl bg-[#e5352b] text-white hover:bg-[#cf3027]" onClick={closePayment}>Готово</Button>
                </div>
              ) : payment.status === "processing" ? (
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <span className="grid size-[62px] place-items-center rounded-full bg-[#fff0ee] text-[#e5352b]"><LoaderCircle className="size-8 animate-spin" /></span>
                  <p className="text-sm font-medium">Проводим тестовую оплату…</p>
                  <p className="text-xs text-[#858990]">Обычно это занимает несколько секунд</p>
                </div>
              ) : (
                <>
                  <div className="mt-6 flex items-center gap-3 rounded-2xl bg-[#f7f7f8] p-3.5">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#fff0ee] text-[#e5352b]"><span className="text-[11px] font-extrabold">RWA</span></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-[#858990]">Получатель</span>
                      <span className="mt-0.5 block text-sm font-semibold">RWA Bridge</span>
                    </span>
                  </div>

                  <div className="py-6 text-center">
                    <p className="text-[34px] font-semibold tracking-tight tabular-nums">{formatTenge(payment.amountKzt)}</p>
                    <p className="mt-1 text-sm text-[#858990]">≈ {formatMoney(payment.amountUsd)} · {marketData.rate.stale ? "ориентировочный курс" : "курс приложения"}</p>
                  </div>

                  <div className="divide-y divide-[#eeeeef] rounded-2xl border border-[#eeeeef] px-4">
                    <div className="flex items-center justify-between gap-4 py-3.5">
                      <span className="text-sm text-[#777b82]">Счёт списания</span>
                      <span className="text-right text-sm font-medium">Демо-карта ·· 4821</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3.5">
                      <span className="text-sm text-[#777b82]">Баланс карты</span>
                      <span className="text-sm font-medium tabular-nums">{formatTenge(bankBalanceKzt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3.5">
                      <span className="text-sm text-[#777b82]">Комиссия</span>
                      <span className="text-sm font-medium">0 ₸</span>
                    </div>
                  </div>

                  <p className="mt-4 rounded-xl bg-[#fff8e9] px-3 py-2.5 text-center text-xs leading-4 text-[#8d6b25]">Тестовая оплата — деньги не списываются</p>
                  <Button className="mt-4 h-12 w-full rounded-xl bg-[#e5352b] text-base font-semibold text-white hover:bg-[#cf3027]" onClick={() => setPayment((current) => current ? { ...current, status: "processing" } : null)}>
                    Оплатить
                  </Button>
                  <button type="button" onClick={closePayment} className="mt-2 h-10 w-full rounded-xl text-sm font-medium text-[#64686f] hover:bg-[#f7f7f8]">Отмена</button>
                </>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}

function ServiceTile({
  label,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: typeof ShoppingBag;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="relative flex min-h-[80px] flex-col items-center justify-start gap-2 rounded-xl px-1 py-1 text-center">
      <span className={`relative grid size-11 place-items-center rounded-[15px] ${active ? "bg-[#fff0ee] text-[#e5352b]" : "bg-[#f7f7f8] text-[#e5352b]"}`}>
        <Icon className="size-[21px] stroke-[1.8]" />
        {active ? <span className="absolute -right-2 -top-1 rounded-full bg-[#e5352b] px-1.5 py-0.5 text-[8px] font-semibold leading-none text-white">Новое</span> : null}
      </span>
      <span className="text-[10px] font-medium leading-3.5 text-[#555960]">{label}</span>
    </button>
  );
}

function BottomTab({
  label,
  icon: Icon,
  active = false,
  badge = false,
  onClick,
}: {
  label: string;
  icon: typeof Home;
  active?: boolean;
  badge?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] ${active ? "font-semibold text-[#e5352b]" : "text-[#858990]"}`}>
      <span className="relative">
        <Icon className="size-[19px]" />
        {badge ? <span className="absolute -right-1.5 -top-1 size-2 rounded-full border border-white bg-[#e5352b]" /> : null}
      </span>
      <span>{label}</span>
    </button>
  );
}
