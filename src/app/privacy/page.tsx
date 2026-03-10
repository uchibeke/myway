import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy — Myway',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          &larr; Home
        </Link>
        <h1 className="mt-6 text-2xl font-bold text-zinc-100">Privacy Policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: March 6, 2026</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-zinc-100">In plain English</h2>
            <p>
              We collect the minimum data needed to run Myway. We do not sell your
              data. We do not show you ads. Your conversations and files belong to you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">What we collect</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-zinc-200">Account info</strong> — email
                address, display name, and authentication data (provided by you or
                our partner AppRoom).
              </li>
              <li>
                <strong className="text-zinc-200">Conversations</strong> — messages
                you send and AI responses, stored to provide the service and let you
                access your history.
              </li>
              <li>
                <strong className="text-zinc-200">Files</strong> — documents you
                upload, stored in your personal storage space.
              </li>
              <li>
                <strong className="text-zinc-200">Usage data</strong> — token counts
                and costs for billing and usage limits. We do not track browsing
                behavior or use analytics trackers.
              </li>
              <li>
                <strong className="text-zinc-200">Connected accounts</strong> — if
                you connect Gmail or Calendar, we store encrypted OAuth tokens to
                sync data on your behalf. We access only what you authorize.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">How we use your data</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>To provide and improve Myway</li>
              <li>To process your messages through AI providers (see below)</li>
              <li>To enforce usage limits and prevent abuse</li>
              <li>To send you service-related emails (no marketing)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">AI providers</h2>
            <p>
              When you send a message, it is forwarded to a third-party AI provider
              (such as OpenRouter, OpenAI, Anthropic, or others) to generate a
              response. These providers process your message under their own privacy
              policies. We select providers that do not use your data for training
              when such options are available.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Data storage and security</h2>
            <p>
              Your data is stored on servers we operate. Conversations and files are
              isolated per user — other users cannot access your data. We use
              encryption for sensitive data at rest and in transit. Authentication
              tokens are stored encrypted. We follow security best practices, but no
              system is perfectly secure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Data sharing</h2>
            <p>
              We do not sell your personal data. We share data only with:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>AI providers, to process your messages (as described above)</li>
              <li>AppRoom, our authentication and billing partner</li>
              <li>Law enforcement, if required by law</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Data retention</h2>
            <p>
              We keep your data as long as your account is active. If you delete your
              account, we delete your data within 30 days. Some data may be retained
              in backups for up to 90 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Your rights</h2>
            <p>You can:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Access and download your data</li>
              <li>Delete your conversations and files</li>
              <li>Disconnect third-party accounts</li>
              <li>Request account deletion</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Google API data</h2>
            <p>
              If you connect your Google account (Gmail, Calendar), Myway accesses
              only the data you explicitly authorize through Google&rsquo;s consent
              screen. Specifically:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-zinc-200">Gmail</strong> — read-only access
                to retrieve emails for briefings and summaries. We do not send emails
                on your behalf or modify your mailbox.
              </li>
              <li>
                <strong className="text-zinc-200">Calendar</strong> — read access to
                show your upcoming events. We do not create, modify, or delete events.
              </li>
            </ul>
            <p className="mt-2">
              Myway&rsquo;s use and transfer of information received from Google APIs
              adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Google data is used solely to
              provide the features you requested and is not used for advertising,
              market research, or transfer to third parties unrelated to the service.
            </p>
            <p className="mt-2">
              You can revoke Myway&rsquo;s access to your Google data at any time
              from your{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Google Account permissions page
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Cookies</h2>
            <p>
              We use essential cookies only — session authentication and CSRF
              protection. No tracking cookies, no analytics cookies, no advertising
              cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Children</h2>
            <p>
              Myway is not intended for children under 13. We do not knowingly
              collect data from children.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Changes</h2>
            <p>
              We may update this policy. Significant changes will be communicated
              through the service. Continued use constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Contact</h2>
            <p>
              Privacy questions? Email{' '}
              <a href="mailto:privacy@myway.sh" className="text-blue-400 hover:underline">
                privacy@myway.sh
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
