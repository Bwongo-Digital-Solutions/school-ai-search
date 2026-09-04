import React, { useEffect, useRef, useState } from 'react';
import { Button, InlineLoading } from '@carbon/react';
import { Application, Education, Launch, Renew } from '@carbon/react/icons';
import { AccessDenied, PageHeader } from '@/components/common';
import { loadIntegrations, type Integration } from '@/lib/integrations';
import styles from './embedded-system.module.scss';

/**
 * A system the school has connected, shown inside the app.
 *
 * Framing is attempted rather than assumed. Many systems send `X-Frame-Options: DENY`, and a
 * browser refuses the frame without telling the page why — no error event, no readable status. The
 * only signal available is that `load` never fires, so a timer decides: if nothing has loaded by
 * then, the frame is replaced with a way to open it in a tab. That is a guess, and it is the honest
 * one available; a school whose Moodle refuses framing still gets a working link rather than a
 * permanently blank panel.
 */
const EmbeddedSystem: React.FC<{ kind: 'elearning' | 'erp' }> = ({ kind }) => {
  const [integration, setIntegration] = useState<Integration | null | undefined>(undefined);
  const [framed, setFramed] = useState<'waiting' | 'shown' | 'refused'>('waiting');
  const timer = useRef<number>();

  useEffect(() => {
    let cancelled = false;
    loadIntegrations()
      .then((state) => {
        if (cancelled) return;
        setIntegration(state.integrations.find((entry) => entry.kind === kind && entry.enabled && entry.baseUrl) ?? null);
      })
      .catch(() => !cancelled && setIntegration(null));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (!integration || framed !== 'waiting') return undefined;
    timer.current = window.setTimeout(() => setFramed('refused'), 4000);
    return () => window.clearTimeout(timer.current);
  }, [integration, framed]);

  const title = kind === 'elearning' ? 'E-Learning' : 'Business system';
  const Icon = kind === 'elearning' ? Education : Application;

  if (integration === undefined) {
    return (
      <div className={styles.screen}>
        <PageHeader title={title} illustration={<Icon size={32} />} />
        <div className={styles.fallback}>
          <InlineLoading description="Loading…" />
        </div>
      </div>
    );
  }

  if (!integration) {
    return (
      <AccessDenied
        title={`No ${kind === 'elearning' ? 'e-learning system' : 'business system'} is connected`}
        message="An administrator connects one under Settings → Integrations. Once it is there, it opens here."
      />
    );
  }

  return (
    <div className={styles.screen}>
      <PageHeader title={integration.label} illustration={<Icon size={32} />}>
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Renew}
          onClick={() => setFramed('waiting')}
          disabled={framed === 'waiting'}
        >
          Reload
        </Button>
        <Button kind="ghost" size="sm" renderIcon={Launch} href={integration.baseUrl} target="_blank">
          Open in a new tab
        </Button>
      </PageHeader>

      <div className={styles.frameWrap}>
        {framed === 'refused' ? (
          <div className={styles.fallback}>
            <p className={styles.fallbackTitle}>{integration.label} will not open inside the app</p>
            <p className={styles.fallbackCopy}>
              Many systems refuse to be shown inside another site, which is a sensible thing for them
              to do — it is what stops a page it does not trust wrapping its login. It works normally
              in its own tab.
            </p>
            <p className={styles.address}>{integration.baseUrl}</p>
            <Button kind="primary" renderIcon={Launch} href={integration.baseUrl} target="_blank">
              Open {integration.label}
            </Button>
          </div>
        ) : (
          <iframe
            key={String(framed)}
            src={integration.baseUrl}
            title={integration.label}
            className={styles.frame}
            onLoad={() => {
              window.clearTimeout(timer.current);
              setFramed('shown');
            }}
          />
        )}
      </div>
    </div>
  );
};

export default EmbeddedSystem;
