import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const DEFAULT_IFRAME_HEIGHT = 600;

/**
 * PelecardIframe renders a Pelecard payment iframe once a checkout session is
 * created on the server.
 *
 * Required props:
 * - orderId: unique identifier for the order (maps to UserKey / ParamX).
 * - total: total amount **in agorot** (string or number). E.g. 100 = 1₪.
 *
 * Optional props:
 * - currency: Pelecard currency code (default "1" = ILS).
 * - language: Pelecard UI language (default "HE").
 * - qaResultStatus: optional sandbox override, e.g. "000".
 * - className: applied to the iframe wrapper.
 * - iframeHeight: overrides the default iframe height.
 * - onReady(url): callback when iframe URL is ready.
 * - onError(error): callback when an error occurs.
 * - orderData: full order data to store on server (cartItems, locationData, menuRevision, etc.)
 *
 * The component expects the backend endpoint `/pelecard/get-iframe-url`
 * implemented by `order_sys/server/pelecard.js` to return `{ iframeUrl: string }`.
 */
export default function PelecardIframe({
  orderId,
  total,
  currency = '1',
  language = 'HE',
  qaResultStatus,
  className,
  iframeHeight = DEFAULT_IFRAME_HEIGHT,
  onReady,
  onError,
  orderData,
}) {
  const { t } = useTranslation();
  const [iframeUrl, setIframeUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState('');

  const requestPayload = useMemo(() => {
    if (!orderId || total === undefined || total === null) {
      return null;
    }

    const normalizedTotal =
      typeof total === 'number' ? Math.round(total).toString() : `${total}`;

    return {
      orderId,
      total: normalizedTotal,
      currency,
      language,
      qaResultStatus,
      orderData, // Include full order data
    };
  }, [currency, language, orderId, qaResultStatus, total, orderData]);

  useEffect(() => {
    async function fetchIframeUrl() {
      if (!requestPayload) {
        setStatus('error');
        setError('Missing orderId or total for Pelecard checkout.');
        onError?.(new Error('Missing orderId or total for Pelecard checkout.'));
        return;
      }

      try {
        setStatus('loading');
        setError('');

        const response = await fetch('/pelecard/get-iframe-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
          credentials: 'include',
        });

        if (!response.ok) {
          const message = `Failed to create Pelecard checkout (HTTP ${response.status}).`;
          throw new Error(message);
        }

        const data = await response.json();

        if (!data?.iframeUrl) {
          throw new Error('Pelecard checkout response did not include iframeUrl.');
        }

        setIframeUrl(data.iframeUrl);
        setStatus('ready');
        onReady?.(data.iframeUrl);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unexpected error while creating Pelecard checkout.';

        setStatus('error');
        setError(message);
        onError?.(err instanceof Error ? err : new Error(message));
        console.error('[PelecardIframe] Failed to load iframe URL:', err);
      }
    }

    fetchIframeUrl();
  }, [onError, onReady, requestPayload]);

  if (status === 'loading' || status === 'idle') {
    return (
      <div className={className}>
        <p>{t('payment.preparingCheckout')}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={className}>
        <p role="alert">{t('payment.loadError')} {error}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <iframe
        id="pelecard-checkout"
        src={iframeUrl}
        width="100%"
        height={iframeHeight}
        frameBorder="0"
        allow="payment *"
        allowPaymentRequest
        title={t('payment.iframeTitle')}
      />
    </div>
  );
}



