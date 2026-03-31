"use client";

import { usePathname } from "next/navigation";
import { Check } from "lucide-react";

const STEPS = [
  { label: "Clinic", path: "/setup/clinic" },
  { label: "Rooms", path: "/setup/rooms" },
];

function StepIndicator() {
  const pathname = usePathname();
  const currentIndex = STEPS.findIndex((s) => pathname.startsWith(s.path));

  return (
    <nav aria-label="Setup progress" className="flex items-center gap-3">
      {STEPS.map((step, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <div key={step.path} className="flex items-center gap-3">
            {i > 0 && (
              <div
                className={`w-8 h-px ${
                  isComplete ? "bg-green-500" : "bg-gray-200"
                }`}
              />
            )}
            <div className="flex items-center gap-1.5">
              {isComplete ? (
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <Check size={12} className="text-white" />
                </div>
              ) : (
                <div
                  className={`w-5 h-5 rounded-full border-2 ${
                    isCurrent
                      ? "border-teal-500 bg-teal-500"
                      : "border-gray-300"
                  }`}
                />
              )}
              <span
                className={`text-sm font-medium ${
                  isCurrent
                    ? "text-teal-600"
                    : isComplete
                      ? "text-green-600"
                      : "text-gray-400"
                }`}
                aria-current={isCurrent ? "step" : undefined}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between px-6 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/images.png" alt="Coviu" className="h-5" />
        <StepIndicator />
        <div className="w-[72px]" /> {/* Spacer for centering */}
      </header>

      <main className="flex justify-center px-4 pt-4 pb-8">
        <div className="w-full max-w-[520px] bg-white border border-gray-200 rounded-2xl p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
