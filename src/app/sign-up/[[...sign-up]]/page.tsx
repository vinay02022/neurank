import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Sparkles } from "lucide-react";

export const metadata = {
  title: "Sign up",
};

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-ai-gradient text-white">
            <Sparkles className="size-4" />
          </span>
          <span>Neurank</span>
        </Link>
        <SignUp
          signInUrl="/sign-in"
          forceRedirectUrl="/onboarding"
          fallbackRedirectUrl="/onboarding"
        />
      </div>
    </main>
  );
}
