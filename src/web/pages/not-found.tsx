import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="screen grid min-h-[50vh] place-items-center rounded-lg px-6 text-center">
      <div className="grid justify-items-center gap-6">
        <p className="subtitle-line text-2xl">[silence]</p>
        <p className="text-sm text-[#a3a9b6]">There is nothing at this address.</p>
        <Button asChild variant="primary">
          <Link to="/">Go to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
