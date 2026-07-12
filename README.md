# ☀️ 3D Solar System Simulator

An interactive, real-time 3D simulation of our Solar System built entirely with **Three.js**. Explore planets, dwarf planets, moons, asteroid belts, and deep-sky objects with realistic orbital mechanics, dynamic scaling, and a sci-fi inspired UI.

![Solar System](https://img.shields.io/badge/Three.js-r164-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## 🚀 Features

### Celestial Bodies
- **The Sun** — with glow sprite and bloom post-processing
- **8 Planets** — Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune
- **5 Dwarf Planets** — Ceres, Pluto, Eris, Haumea, Makemake
- **25+ Natural Satellites** — including the Moon, Galilean moons, Titan, Triton, Charon, and more
- **Asteroid Belts** — Main Belt (between Mars and Jupiter) and Kuiper Belt (beyond Neptune)
- **Saturn's Rings** — with proper UV mapping and transparency

### Orbital Mechanics
- Elliptical orbits with real eccentricity and inclination values
- Accurate semi-major axes scaled to scene units (1 AU = 6.5 units)
- Orbital periods proportional to real data
- Satellites orbit their parent bodies in real-time
- **Kepler's Equation Solver** — accurately calculates real heliocentric positions using iterative Newton-Raphson method for precise orbital mechanics

### AI & Smart Features
- **AI Tourist Guide** — powered by Ollama (`gemma4:e4b`), generates dynamic, enthusiastic descriptions in Italian for selected celestial bodies
- **Text-To-Speech (TTS)** — reads AI-generated descriptions aloud using browser-native speech synthesis with Italian voice support
- **Semantic Search** — natural language query interpretation with intent classification (navigation vs. astronomy questions)
- **Query Classification** — automatically distinguishes between "take me to Mars" (navigation) and "what are Jupiter's moons?" (question)
- **Streaming Responses** — real-time AI response generation with progressive text display
- **Response Caching** — intelligent caching of AI responses to reduce redundant API calls

### Interactive Game Mode
- **Quiz Mode** — educational astronomy quiz game ("Fuga dalla Terra" / Earth Escape)
- **Interactive Challenges** — answer astronomy questions to progress
- **Game UI Panel** — dedicated game interface with status, hints, and input controls
- **Toggle Control** — easily switch between simulation and game modes

### Visual & Technical
- **Glass Morphism UI** — modern frosted glass aesthetic with backdrop blur effects
- **Dynamic Scaling** — objects maintain a minimum pixel size on screen regardless of distance, preventing them from disappearing when zoomed out
- **LOD (Level of Detail)** — automatic texture switching between 2K and 8K based on camera distance
- **Post-Processing** — Unreal Bloom pass for realistic star glow
- **Adaptive Near/Far Planes** — allows extreme zoom from full system view down to satellite surfaces
- **12,000 background stars** with random distribution
- **Ecliptic grid** for spatial reference
- **ACES Filmic Tone Mapping** — professional color grading for realistic rendering

### Interactive Controls
- **Orbit Camera** — rotate, pan, and zoom freely with mouse/touch
- **Play/Pause** — freeze or resume the simulation
- **Speed Control** — adjustable from 0.1x to 50x real-time (1 second = 1 day at 1x)
- **Timeline Scrubber** — visual timeline with draggable progress indicator
- **Search System** — sci-fi styled search bar with autocomplete suggestions and keyboard shortcut (`/`)
- **Object Tracking** — smooth camera animation to any object with automatic framing
- **Target HUD** — animated bracket overlay with distance readout when tracking
- **Date Display** — real-time simulation date and time indicator
- **Audio Toggle** — mute/unmute AI narration with dedicated button

---

## 🛠️ Installation & Usage

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, Safari)
- A local HTTP server (required for texture loading due to CORS)
- **For AI features:** A local [Ollama](https://ollama.com/) server running on port 11434 with the `gemma4:e4b` model installed

### Quick Start

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/yourusername/solar-system-3d.git
   cd solar-system-3d
   ```

2. **Add texture files** to the `Texture/` directory following the structure below:
   ```
   Texture/
   ├── 8k_sun.jpg
   ├── 8k_mercury.jpg
   ├── 8k_venus.jpg
   ├── 8k_earth.jpg
   ├── 8k_mars.jpg
   ├── 8k_jupiter.jpg
   ├── 8k_saturn.jpg
   ├── 8k_uranus.jpg
   ├── 8k_neptune.jpg
   ├── 8k_moon.jpg
   ├── [satellite textures...]
   └── [dwarf planet textures...]
   ```
   - Textures can be sourced from [Solar System Scope](https://www.solarsystemscope.com/textures/) or similar free resources

3. **Start a local server**:
   ```bash
   # Using Python 3
   python -m http.server 8000

   # Using Node.js (npx)
   npx serve .

   # Using VS Code
   # Install "Live Server" extension and click "Go Live"
   ```

4. **Open in browser**:
   ```
   http://localhost:8000
   ```

5. **Enable AI Features** (optional):
   - Install [Ollama](https://ollama.com/)
   - Pull the required model: `ollama pull gemma4:e4b`
   - Start Ollama server: `ollama serve`
   - The app will auto-detect the AI server on startup

---

## 🎮 Controls

| Action | Input |
|--------|-------|
| **Rotate view** | Left-click + drag |
| **Pan** | Right-click + drag / Middle-click + drag |
| **Zoom** | Scroll wheel / Pinch |
| **Search object** | Type in the search bar (top center) or press `/` |
| **Navigate to object** | Click suggestion or press Enter |
| **Stop tracking** | Click "✕ STOP" button |
| **Play/Pause** | Click ▶ Play / ⏸ Pause buttons |
| **Adjust speed** | Drag the speed slider (0.1x – 50x) |
| **Toggle audio** | Click the audio button (bottom right of controls) |
| **Open game mode** | Click the 🚀 button (bottom right corner) |

---

## ⚙️ Technical Details

### Scale & Units
| Parameter | Value |
|-----------|-------|
| 1 AU (Astronomical Unit) | 6.5 scene units |
| Planet radii | Real proportions (km → AU → scene units) |
| Orbital distances | Real semi-major axes in AU |
| Time scale | 1 real second = 1 simulated day (at 1x speed) |

### Dynamic Scaling System
Objects are guaranteed a **minimum pixel size** on screen:
- Planets: 8px minimum
- Sun: 20px minimum
- Satellites: 4px minimum
- Asteroids: 2-25px scale range

This ensures visibility at any zoom level while preserving real proportions when close.

### Kepler Orbital Mechanics
The simulator uses the **Newton-Raphson iterative method** to solve Kepler's equation:
```
M = E - e × sin(E)
```
Where:
- M = Mean anomaly
- E = Eccentric anomaly (solved iteratively)
- e = Orbital eccentricity

This provides accurate heliocentric positions accounting for:
- Orbital eccentricity
- Inclination to the ecliptic
- Argument of perihelion
- Longitude of ascending node

### AI Architecture
- **Intent Classification**: LLM-based query classification (navigate vs. question)
- **Streaming Generation**: Real-time token-by-token response streaming
- **Voice Synthesis**: Browser SpeechSynthesis API with Italian voice selection
- **Response Caching**: In-memory cache for repeated queries
- **Auto-detection**: Automatic Ollama server availability check on startup

### Dependencies (loaded via CDN)
- [Three.js r164](https://threejs.org/) — 3D rendering engine
- OrbitControls — camera interaction
- EffectComposer + UnrealBloomPass — post-processing

No build step required. All dependencies are loaded via ES Module import maps from unpkg CDN.

---

## 🎨 Customization

### Adding New Objects
To add a new celestial body, add an entry to the appropriate data array in the script:

```javascript
// Example: adding a new dwarf planet
{ 
  name: 'Sedna', 
  aAU: 506.8,        // semi-major axis in AU
  e: 0.8459,         // eccentricity
  iDeg: 11.93,       // inclination in degrees
  period: 4161082.0, // orbital period in days
  radiusAU: 497.5 * KM_TO_AU, // radius
  color: 0xff4444    // fallback color
}
```

### Adjusting Visual Parameters
Key constants at the top of the script:
```javascript
const AU_SCALE = 6.5;          // Scene scale factor
const MIN_PIXEL_SIZE = 8;      // Minimum planet size in pixels
const SUN_MIN_PIXEL_SIZE = 20; // Minimum sun size in pixels
const LOD_THRESHOLD = 0.05;    // Distance to switch to high-res textures
```

### AI Configuration
```javascript
const AI = {
  url: 'http://localhost:11434',
  model: 'gemma4:e4b',
  enabled: false,      // auto-detected on startup
  cache: new Map()     // response cache
};
```

---

## 📝 Notes

- **Orbital accuracy**: The simulation uses Kepler's equation for accurate ephemeris calculations, suitable for educational and visualization purposes
- **Dwarf planet textures**: Some textures (Eris, Haumea, Makemake) are fictional/artistic representations since no high-resolution imagery exists
- **Performance**: The scene renders ~18,000+ objects (asteroids, stars, planets). On lower-end devices, consider reducing asteroid counts
- **Deep-sky objects**: M31, M42, and M45 are included as navigable targets with approximate directional positions (not to scale with real distances)
- **AI language**: The AI guide responds in Italian by default; modify the system prompt in the code for other languages
- **TTS voices**: Voice availability depends on the browser and operating system; Italian voices are preferred when available

---

## 📜 License

This project is released under the **MIT License**. Feel free to use, modify, and distribute.

Texture assets may have their own licenses — please check the source providers.

---

## 🙏 Credits

- **Three.js** — [threejs.org](https://threejs.org/)
- **Textures** — [Solar System Scope](https://www.solarsystemscope.com/textures/), NASA, Celestia
- **Orbital Data** — NASA JPL, Wikipedia
- **AI Model** — Google Gemma via Ollama
- **Font** — Inter by Rasmus Andersson

---

## 🗺️ Roadmap

- [ ] Multi-language AI support
- [ ] VR mode support
- [ ] Multiplayer shared sessions
- [ ] Export orbital data to CSV
- [ ] Time travel presets (historical dates)
- [ ] Comet and asteroid tracking

---

*Built with ☕ and curiosity about the cosmos.*
