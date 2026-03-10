import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service — Myway',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          &larr; Home
        </Link>
        <h1 className="mt-6 text-2xl font-bold text-zinc-100">Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: March 6, 2026</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-zinc-100">1. What Myway is</h2>
            <p>
              Myway is an AI-powered personal assistant. We provide tools to help you
              organize information, communicate, and get things done. Your use of Myway
              is subject to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">2. Your account</h2>
            <p>
              You need an account to use Myway. You are responsible for keeping your
              login credentials secure. If you suspect unauthorized access, let us know
              immediately.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">3. Your data</h2>
            <p>
              You own your data. We do not sell your personal information to third
              parties. We store your data to provide the service and may process it
              through AI providers to respond to your requests. See our{' '}
              <Link href="/privacy" className="text-blue-400 hover:underline">
                Privacy Policy
              </Link>{' '}
              for details.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">4. Acceptable use</h2>
            <p>
              Use Myway for lawful purposes. Do not use it to generate harmful,
              abusive, or illegal content. Do not attempt to circumvent usage limits,
              reverse-engineer the service, or interfere with other users.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">5. AI-generated content</h2>
            <p>
              Myway uses third-party AI models to generate responses. AI output may be
              inaccurate, incomplete, or outdated. You should verify important
              information independently. We are not responsible for decisions you make
              based on AI-generated content.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">6. Service availability</h2>
            <p>
              We aim to keep Myway available and reliable, but we do not guarantee
              uninterrupted or error-free service. We may modify, suspend, or
              discontinue features at any time. We will try to give reasonable notice
              for significant changes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">7. Usage limits and billing</h2>
            <p>
              Free accounts have usage limits. Paid plans provide higher limits.
              AI usage incurs real costs from third-party providers, so limits are
              necessary to keep the service running. We may adjust pricing and limits
              with notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">8. Limitation of liability</h2>
            <p>
              Myway is provided &ldquo;as is&rdquo; without warranties of any kind,
              express or implied. To the fullest extent permitted by law, we are not
              liable for any indirect, incidental, or consequential damages arising
              from your use of the service. Our total liability is limited to the
              amount you paid us in the 12 months before the claim.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">9. Termination</h2>
            <p>
              You can stop using Myway at any time. We may suspend or terminate
              accounts that violate these terms. On termination, you can request an
              export of your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">10. Changes to these terms</h2>
            <p>
              We may update these terms from time to time. If we make significant
              changes, we will notify you through the service. Continued use after
              changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">11. Contact</h2>
            <p>
              Questions about these terms? Reach us at{' '}
              <a href="mailto:support@myway.sh" className="text-blue-400 hover:underline">
                support@myway.sh
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
