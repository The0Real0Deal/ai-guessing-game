import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeCardProps {
  url: string;
  size?: number;
  caption?: string;
}

export function QRCodeCard({ url, size = 240, caption = 'סרקו עם המצלמה כדי להצטרף!' }: QRCodeCardProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      width: size,
      margin: 2,
      color: {
        dark: '#111111',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((res) => {
        if (active) setDataUrl(res);
      })
      .catch(() => {
        // ignore
      });

    return () => {
      active = false;
    };
  }, [url, size]);

  return (
    <div className="qr-card">
      {dataUrl ? (
        <img src={dataUrl} alt="קוד QR להצטרפות למשחק" width={size} height={size} className="qr-img" />
      ) : (
        <div className="qr-skeleton" style={{ width: size, height: size }} />
      )}
      <span className="qr-caption">{caption}</span>
    </div>
  );
}
