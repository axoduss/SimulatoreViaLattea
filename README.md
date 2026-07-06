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
- **Kepler's Equation** — accurately solved to calculate real heliocentric positions in the ecliptic plane.

### AI & Smart Features
- **AI Tourist Guide** — powered by Ollama (`gemma4:e4b`), generates dynamic, enthusiastic descriptions in Italian for selected celestial bodies.
- **Text-To-Speech (TTS)** — reads the AI-generated descriptions aloud.
- **Semantic Search** — natural language query interpretation (e.g., "il pianeta rosso") alongside standard autocomplete.


### Visual & Technical
- **Dynamic Scaling** — objects maintain a minimum pixel size on screen regardless of distance, preventing them from disappearing when zoomed out
- **LOD (Level of Detail)** — automatic texture switching between 2K and 8K based on camera distance
- **Post-Processing** — Unreal Bloom pass for realistic star glow
- **Adaptive Near/Far Planes** — allows extreme zoom from full system view down to satellite surfaces
- **12,000 background stars** with random distribution
- **Ecliptic grid** for spatial reference

### Interactive Controls
- **Orbit Camera** — rotate, pan, and zoom freely with mouse/touch
- **Play/Pause** — freeze or resume the simulation
- **Speed Control** — adjustable from 0.1x to 50x real-time (1 second = 1 day at 1x)
- **Search System** — sci-fi styled search bar with autocomplete suggestions
- **Object Tracking** — smooth camera animation to any object with automatic framing
- **Target HUD** — animated bracket overlay with distance readout when tracking

---

## 🛠️ Installation & Usage

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, Safari)
- A local HTTP server (required for texture loading due to CORS)
- **For AI features:** A local [Ollama](https://ollama.com/) server running on port 11434 with the `gemma4:e4b` model installed.

### Quick Start

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/yourusername/solar-system-3d.git
   cd solar-system-3d
   ```

2. **Add texture files** to the `Texture/` directory following the structure above.
   - Textures can be sourced from [Solar System Scope](https://www.solarsystemscope.com/textures/) or similar free resources.

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

---

## 🎮 Controls

| Action | Input |
|--------|-------|
| **Rotate view** | Left-click + drag |
| **Pan** | Right-click + drag / Middle-click + drag |
| **Zoom** | Scroll wheel / Pinch |
| **Search object** | Type in the search bar (top center) |
| **Navigate to object** | Click suggestion or press Enter |
| **Stop tracking** | Click "✕ STOP" button |
| **Play/Pause** | Click ▶ Play / ⏸ Pause buttons |
| **Adjust speed** | Drag the speed slider (0.1x – 50x) |

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

This ensures visibility at any zoom level while preserving real proportions when close.

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

---

## 📝 Notes

- **Orbital approximation**: The simulation uses mean anomaly (circular approximation on ellipses) rather than solving Kepler's equation. This is visually accurate but not suitable for precise ephemeris calculations.
- **Dwarf planet textures**: Some textures (Eris, Haumea, Makemake) are fictional/artistic representations since no high-resolution imagery exists.
- **Performance**: The scene renders ~18,000+ objects (asteroids, stars, planets). On lower-end devices, consider reducing asteroid counts.
- **Deep-sky objects**: M31, M42, and M45 are included as navigable targets with approximate directional positions (not to scale with real distances).

---

## 📜 License

This project is released under the **MIT License**. Feel free to use, modify, and distribute.

Texture assets may have their own licenses — please check the source providers.

---

## 🙏 Credits

- **Three.js** — [threejs.org](https://threejs.org/)
- **Textures** — [Solar System Scope](https://www.solarsystemscope.com/textures/), NASA, Celestia
- **Orbital Data** — NASA JPL, Wikipedia

---

*Built with ☕ and curiosity about the cosmos.*
