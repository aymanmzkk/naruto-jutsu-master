import { useState } from 'react';
import { MenuBackground } from './MenuBackground';
import { LevelSelector } from '../LevelSelector/LevelSelector';
import { ArtDefs } from '../LevelSelector/LevelArtwork';
import { SettingsModal } from '../Settings/SettingsModal';
import { IconLab, IconSettings, IconSound } from '../Icons';
import { settingsStore, updateSettings } from '../../state/settingsStore';
import { useStore } from '../../state/createStore';
import { Sound } from '../../audio/SoundEngine';

export function MainMenu({ onPlay, onLab }: { onPlay: (id: number) => void; onLab: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const muted = useStore(settingsStore, (s) => s.debug.muted);
  return (
    <main className="screen menu screen-enter">
      <ArtDefs />
      <MenuBackground />
      <header className="menu__header">
        <div className="menu__brand">
          <div className="menu__seal kanji">術</div>
          <div>
            <h1 className="menu__title display">
              NARUTO <span className="menu__dash">—</span> <span className="menu__title-accent">JUTSU MASTER</span>
            </h1>
            <p className="menu__tagline">Weave the signs with your own hands. Release the jutsu with your breath.</p>
          </div>
        </div>
        <nav className="menu__actions">
          <button
            className="btn btn--ghost"
            onMouseEnter={() => Sound.hover()}
            onClick={() => {
              Sound.click();
              onLab();
            }}
          >
            <IconLab width={18} height={18} /> NUI LAB
          </button>
          <button className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)} onMouseEnter={() => Sound.hover()}>
            <IconSettings />
          </button>
          <button
            className="icon-btn"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => updateSettings('debug', { muted: !muted })}
            onMouseEnter={() => Sound.hover()}
          >
            <IconSound muted={muted} />
          </button>
        </nav>
      </header>

      <div className="menu__section-head">
        <span className="kanji">修行</span>
        <h2 className="display">SELECT YOUR TRAINING</h2>
        <span className="menu__line" />
        <span className="menu__count">1 / 10 UNLOCKED</span>
      </div>
      <LevelSelector onPlay={onPlay} />

      <footer className="menu__footer">
        <span>Natural User Interface project · Webcam hand tracking (MediaPipe) · Microphone blow detection (Web Audio)</span>
        <span>Fan-made academic project · Not affiliated with the original series</span>
      </footer>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
