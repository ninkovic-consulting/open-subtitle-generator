import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { Layout } from '@/components/layout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useServerEvents } from '@/lib/sse';
import { CostsPage } from '@/pages/costs';
import { DashboardPage } from '@/pages/dashboard';
import { EditorPage } from '@/pages/editor';
import { JobPage } from '@/pages/job';
import { NewTranslationPage } from '@/pages/new-translation';
import { NotFoundPage } from '@/pages/not-found';
import { ProjectPage } from '@/pages/project';
import { ProjectsPage } from '@/pages/projects';
import { SettingsPage } from '@/pages/settings';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/new', element: <NewTranslationPage /> },
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/projects/:id', element: <ProjectPage /> },
      { path: '/jobs/:id', element: <JobPage /> },
      { path: '/jobs/:id/editor', element: <EditorPage /> },
      { path: '/costs', element: <CostsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

function EventBridge() {
  useServerEvents();
  return null;
}

export function App() {
  return (
    <TooltipProvider>
      <EventBridge />
      <RouterProvider router={router} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: '!bg-panel !border-line !text-text !font-sans',
            description: '!text-muted',
          },
        }}
      />
    </TooltipProvider>
  );
}
