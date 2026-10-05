import { buttonClass } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';

export function PdfSection() {
  return (
    <Card id="pdf">
      <CardHeader
        title="PDF-профиль"
        description="Стандартизированный профиль формируется на сервере. Ваша версия полная; работодатель получает только версию в объёме своих прав."
      />
      <a href="/api/v1/candidate/profile/pdf" className={buttonClass('outline')} download>
        Скачать полный PDF
      </a>
    </Card>
  );
}
