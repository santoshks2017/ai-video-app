import { useEffect } from 'react';
import { useApp } from './state/appStore.js';
import { Shell, SignIn } from './components/Shell.js';
import { ProjectsSection } from './sections/Projects.js';
import { ProjectEditor } from './sections/ProjectEditor.js';
import { ActorsSection } from './sections/Actors.js';
import { CarsSection } from './sections/Cars.js';
import { ClientsSection } from './sections/Clients.js';
import { InstructionsSection } from './sections/Instructions.js';
import { LanguagesSection } from './sections/Languages.js';
import { ModelsSection } from './sections/Models.js';

export default function App() {
  const { signedIn, section, openProjectId, init } = useApp();

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
      {section === 'projects' &&
        (openProjectId ? <ProjectEditor projectId={openProjectId} /> : <ProjectsSection />)}
      {section === 'actors' && <ActorsSection />}
      {section === 'cars' && <CarsSection />}
      {section === 'clients' && <ClientsSection />}
      {section === 'instructions' && <InstructionsSection />}
      {section === 'languages' && <LanguagesSection />}
      {section === 'models' && <ModelsSection />}
      <div className="foot-note">
        All use cases generate video through the selected model. Each language&rsquo;s pronunciation and
        on-screen text rules are injected into every prompt that uses it.
      </div>
    </Shell>
  );
}
