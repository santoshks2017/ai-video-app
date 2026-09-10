import { useEffect } from 'react';
import { useApp, type Tab } from './state/appStore.js';
import { Shell, SignIn } from './components/Shell.js';
import { Tabs } from './components/Tabs.js';
import { ProjectsSection } from './sections/Projects.js';
import { ProjectEditor } from './sections/ProjectEditor.js';
import { ActorsSection } from './sections/Actors.js';
import { CarsSection } from './sections/Cars.js';
import { ClientsSection } from './sections/Clients.js';
import { InstructionsSection } from './sections/Instructions.js';
import { LanguagesSection } from './sections/Languages.js';
import { ModelsSection } from './sections/Models.js';
import { WhatsNewSection } from './sections/WhatsNew.js';
import { UsersSection } from './sections/Users.js';

function TabBody({ tab }: { tab: Tab }) {
  if (tab.kind === 'project') return <ProjectEditor projectId={tab.projectId!} />;
  switch (tab.section) {
    case 'projects':
      return <ProjectsSection />;
    case 'actors':
      return <ActorsSection />;
    case 'cars':
      return <CarsSection />;
    case 'clients':
      return <ClientsSection />;
    case 'instructions':
      return <InstructionsSection />;
    case 'languages':
      return <LanguagesSection />;
    case 'models':
      return <ModelsSection />;
    case 'users':
      return <UsersSection />;
    case 'whatsnew':
      return <WhatsNewSection />;
  }
}

export default function App() {
  const { signedIn, previewOpen, tabs, activeTabId, init } = useApp();

  useEffect(() => {
    void init();
  }, [init]);

  if (signedIn === null) {
    return (
      <div className="signin-wrap">
        <div className="hint">Loading…</div>
      </div>
    );
  }
  if (!signedIn) return <SignIn />;

  return (
    <Shell>
      {previewOpen && (
        <div className="preview-banner" role="note">
          Preview, opened without sign-in. Anything generated here spends real money, and edits change the live
          libraries.
        </div>
      )}
      <Tabs />
      {/* Every tab stays mounted: hiding rather than unmounting is what keeps a
          generation running while the designer works somewhere else. */}
      {tabs.map((t) => (
        <div key={t.id} className="pane" hidden={t.id !== activeTabId}>
          <TabBody tab={t} />
        </div>
      ))}
    </Shell>
  );
}
