        import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
        import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
        import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

        // === SCENE SETUP ===
        const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 5000);
        camera.position.set(0, 15, 15);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.85;
        document.getElementById('canvas-container').appendChild(renderer.domElement);
		
		const AU_SCALE = 6.5; // 1 AU = 6.5 scene units
		const KM_TO_AU = 1 / 149597870.7;
		const DEG2RAD = Math.PI / 180;
		
		
		// ============================================================
		//  MODULO AI — infrastruttura condivisa per tutte le funzioni
		// ============================================================
		const AI = {
		  url: 'http://localhost:11434',
		  model: 'gemma4:e4b',
		  enabled: false,      // flag globale: settato dal check iniziale
		  checked: false,      // evita check multipli
		  cache: new Map(),    // cache risposte (chiave = prompt)

		  // Check iniziale, da chiamare una volta all'avvio dell'app
		  async init() {
			if (this.checked) return this.enabled;
			this.checked = true;
			try {
			  const controller = new AbortController();
			  const t = setTimeout(() => controller.abort(), 1500);
			  const res = await fetch(`${this.url}/api/tags`, { signal: controller.signal });
			  clearTimeout(t);
			  this.enabled = res.ok;
			  if (this.enabled) {
				// opzionale: verifica che il modello richiesto sia presente
				const data = await res.json();
				const models = (data.models || []).map(m => m.name);
				const found = models.some(n => n.startsWith(this.model));
				if (!found && models.length) {
				  console.warn(`[AI] Modello "${this.model}" non trovato. Uso "${models[0]}".`);
				  this.model = models[0]; // fallback sul primo disponibile
				}
			  }
			} catch (e) {
			  this.enabled = false;
			}
			console.log(`[AI] ${this.enabled ? 'attiva ✔ (' + this.model + ')' : 'non disponibile ✖'}`);
			this.updateGlobalUI();
			return this.enabled;
		  },
		  
		  
		  

		  // Aggiorna elementi UI globali che dipendono dallo stato AI
		  updateGlobalUI() {
			document.body.classList.toggle('ai-on', this.enabled);
			document.body.classList.toggle('ai-off', !this.enabled);
		  },

		  // ---- Funzione parametrica riutilizzabile ----
		  // options: { prompt, system, json, stream, onChunk, useCache, timeout, signal }
		  async ask(options) {
			if (!this.enabled) throw new Error('AI_DISABLED');

			const {
			  prompt,
			  system = null,
			  json = false,
			  stream = false,
			  onChunk = null,
			  useCache = false,
			  timeout = 200000,
			  signal = null,        // AbortSignal esterno (es. per annullare al cambio oggetto)
			} = options;

			// Cache: solo per risposte non-stream
			const cacheKey = json ? 'json::' + prompt : prompt;
			if (useCache && !stream && this.cache.has(cacheKey)) {
			  return this.cache.get(cacheKey);
			}

			const body = {
			  model: this.model,
			  prompt,
			  stream,
			  ...(system ? { system } : {}),
			  ...(json ? { format: 'json' } : {}),
			};

			const controller = new AbortController();
			const t = setTimeout(() => controller.abort(), timeout);
			// se arriva un abort esterno, propaghiamo
			if (signal) signal.addEventListener('abort', () => controller.abort());

			try {
			  const res = await fetch(`${this.url}/api/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: controller.signal,
			  });
			  if (!res.ok) throw new Error('HTTP ' + res.status);

			  if (stream) {
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let full = '';
				while (true) {
				  const { done, value } = await reader.read();
				  if (done) break;
				  const chunk = decoder.decode(value, { stream: true });
				  for (const line of chunk.split('\n')) {
					if (!line.trim()) continue;
					try {
					  const j = JSON.parse(line);
					  if (j.response) {
						let cleanChunk = j.response.replace(/<\/?backspace>|<\|.*?\|>/g, '');
						full += cleanChunk;
						if (onChunk) onChunk(j.response, full);
					  }
					} catch (_) { /* riga parziale */ }
				  }
				}
				return full;
			  } else {
				const data = await res.json();
				const out = json ? JSON.parse(data.response) : data.response;
				if (useCache) this.cache.set(cacheKey, out);
				return out;
			  }
			} finally {
			  clearTimeout(t);
			}
		  }
		};	
		
		
		// === CLASSIFICAZIONE INTENTO (navigazione vs domanda) ===
		async function classifyQuery(query) {
		  const system = `Classifichi le richieste per un simulatore 3D del Sistema Solare.
		Rispondi SOLO con JSON valido:
		{"intent":"navigate"} se l'utente vuole spostarsi/vedere un corpo celeste,
		{"intent":"question"} se pone una domanda astronomica (es. "quali sono i satelliti di Giove?").`;
		  const res = await AI.ask({
			prompt: `Richiesta utente: "${query}".`,
			system, json: true, useCache: true, timeout: 30000
		  });
		  return (res && res.intent) ? res.intent : 'navigate';
		}
		
		
		// === RISPOSTA A DOMANDE ASTRONOMICHE ===
		async function answerAstronomyQuestion(query) {
		  const panel = document.getElementById('ai-panel');
		  const bodyEl = document.getElementById('ai-narration');
		  const statusEl = document.getElementById('ai-status');
		  panel.classList.add('visible');
		  panel.classList.add('generating');
		  bodyEl.textContent = '';
		  statusEl.textContent = 'genero…';

		  // Contesto reale dal catalogo satelliti presente nel simulatore
		  const satPerPianeta = Object.entries(satelliteData)
			.map(([pianeta, sats]) => `${pianeta}: ${sats.map(s => s.name).join(', ')}`);
		  satPerPianeta.push(`Plutone: ${satelliteDataPlutone.map(s => s.name).join(', ')}`);
		  const contesto = `Satelliti presenti nel simulatore — ${satPerPianeta.join('; ')}.`;

		  if (narrationSignal) narrationSignal.abort();
		  narrationSignal = new AbortController();

		  try {
			let lastSpokenIndex = 0;
			await AI.ask({
			  system: 'Sei una guida astronomica sintetica. Rispondi in italiano, chiaro e conciso, senza elenchi puntati.',
			  prompt: `${contesto}\nDomanda: "${query}". Usa i dati forniti quando pertinenti.`,
			  stream: true,
			  signal: narrationSignal.signal,
			  onChunk: (_piece, full) => {
				const clean = sanitizeLLM(full);
				bodyEl.textContent = clean;
				const pending = clean.slice(lastSpokenIndex);
				const match = pending.match(/[^.!?…]*[.!?…]+/g);
				if (match) {
				  const complete = match.join('');
				  if (complete.trim()) { TTS.speakChunk(complete); lastSpokenIndex += complete.length; }
				}
			  }
			});
			panel.classList.remove('generating');
			statusEl.textContent = 'AI';
			const remaining = bodyEl.textContent.slice(lastSpokenIndex);
			if (remaining.trim()) TTS.speakChunk(remaining);
		  } catch (e) {
			panel.classList.remove('generating');
			if (e.name === 'AbortError') return;
			console.warn('[AI] risposta astronomica fallita:', e);
			statusEl.textContent = 'AI offline';
		  }
		}
		
		
		
		
		
		// === MODULO TTS (Text-To-Speech del browser) ===
		const TTS = {
		  enabled: false,
		  supported: 'speechSynthesis' in window,
		  voice: null,

		  init() {
			if (!this.supported) return;
			const pickVoice = () => {
			  const voices = speechSynthesis.getVoices();
			  const italiane = voices.filter(v => v.lang.startsWith('it'));
			  // preferisci una voce italiana
			  this.voice =
				  italiane.find(v => /google/i.test(v.name)) ||
				  italiane.find(v => v.localService === false) ||
				  italiane.find(v => /(natural|neural|premium|enhanced)/i.test(v.name)) ||
				  italiane[0] ||
				  voices[0] || null;
			};
			pickVoice();
			// le voci possono caricarsi in modo asincrono
			speechSynthesis.onvoiceschanged = pickVoice;
		  },

		  speak(text) {
			if (!this.enabled || !this.supported || !text) return;
			this.stop(); // interrompe eventuale lettura in corso
			const u = new SpeechSynthesisUtterance(text);
			u.lang = 'it-IT';
			if (this.voice) u.voice = this.voice;
			u.rate = 0.95;
			u.pitch = 1.0;
			speechSynthesis.speak(u);
		  },
		  speakChunk(text) {
			  if (!this.enabled || !this.supported || !text || !text.trim()) return;
			  const u = new SpeechSynthesisUtterance(text.trim());
			  u.lang = 'it-IT';
			  if (this.voice) u.voice = this.voice;
			  u.rate = 0.95;
			  u.pitch = 1.0;
			  speechSynthesis.speak(u); // NON chiama stop(): accoda
			},
		  

		  stop() {
			if (this.supported) speechSynthesis.cancel();
		  }
		};
		TTS.init();
		
		
		// Risolve l'equazione di Keplero: M = E - e*sin(E)
		function solveKepler(M, e) {
		  let E = M;
		  for (let i = 0; i < 8; i++) {
			E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
		  }
		  return E;
		}

		// Calcola posizione eliocentrica reale nel piano dell'eclittica
		function keplerPosition(body, days) {
		  const n = 2 * Math.PI / body.period;      // moto medio (rad/giorno)
		  const L = body.LDeg * DEG2RAD + n * days; // longitudine media
		  const varpi = body.varpiDeg * DEG2RAD;
		  const omega = body.omegaDeg * DEG2RAD;
		  const M = L - varpi;                       // anomalia media
		  const E = solveKepler(M, body.e);          // anomalia eccentrica

		  // posizione nel piano orbitale (fuoco = Sole)
		  const xp = body.a * (Math.cos(E) - body.e);
		  const yp = body.b * Math.sin(E);

		  const argP = varpi - omega;                // argomento del perielio
		  const cosW = Math.cos(argP), sinW = Math.sin(argP);
		  const cosO = Math.cos(omega), sinO = Math.sin(omega);
		  const cosI = Math.cos(body.inclination), sinI = Math.sin(body.inclination);

		  // 1) rotazione per argomento del perielio (nel piano orbitale)
		  const x1 = xp * cosW - yp * sinW;
		  const y1 = xp * sinW + yp * cosW;

		  // 2) inclinazione (ribalta y1 su piano verticale)
		  //    piano eclittica: x = est/ovest, z = piano orizzontale, y = verticale
		  const x2 = x1;
		  const y2 = y1 * sinI;
		  const z2 = y1 * cosI;

		  // 3) rotazione per nodo ascendente (attorno all'asse Y verticale)
		  return {
			x: x2 * cosO - z2 * sinO,
			y: y2,
			z: x2 * sinO + z2 * cosO
		  };
		}
		
		// Genera i punti 3D di un'orbita completa usando lo STESSO modello dei corpi
		function buildOrbitPoints(body, segments = 256) {
		  const varpi = body.varpiDeg * DEG2RAD;
		  const omega = body.omegaDeg * DEG2RAD;
		  const argP = varpi - omega;
		  const cosW = Math.cos(argP), sinW = Math.sin(argP);
		  const cosO = Math.cos(omega), sinO = Math.sin(omega);
		  const cosI = Math.cos(body.inclination), sinI = Math.sin(body.inclination);

		  const pts = [];
		  for (let i = 0; i <= segments; i++) {
			const E = (i / segments) * 2 * Math.PI; // anomalia eccentrica
			const xp = body.a * (Math.cos(E) - body.e);
			const yp = body.b * Math.sin(E);

			const x1 = xp * cosW - yp * sinW;
			const y1 = xp * sinW + yp * cosW;

			const x2 = x1;
			const y2 = y1 * sinI;
			const z2 = y1 * cosI;

			pts.push(new THREE.Vector3(
			  x2 * cosO - z2 * sinO,
			  y2,
			  x2 * sinO + z2 * cosO
			));
		  }
		  return pts;
		}

		
		
		
		// === DYNAMIC SCALING PARAMETERS ===
		// I pianeti vengono scalati per avere una dimensione MINIMA sullo schermo
		// indipendentemente dalla distanza. Questo evita che scompaiano da lontano.
		const MIN_PIXEL_SIZE = 8;          // dimensione minima in pixel sullo schermo per i pianeti
		const SUN_MIN_PIXEL_SIZE = 20;     // dimensione minima in pixel per il sole
		const SAT_MIN_PIXEL_SIZE = 4;      // dimensione minima in pixel per i satelliti
		const ASTEROID_MIN_SCALE = 2.0;
		const ASTEROID_MAX_SCALE = 25.0;
		
		// Calcola il fattore di scala per garantire una dimensione minima in pixel
		function getDynamicScale(realRadiusScene, distanceToCamera, minPixels) {
			if (distanceToCamera < 0.0001) return 1.0;

			const fov = THREE.MathUtils.degToRad(camera.fov);
			const screenHeight = window.innerHeight;
			const pixelSize = (realRadiusScene / distanceToCamera) * screenHeight / (2 * Math.tan(fov / 2));

			// Se è già abbastanza grande sullo schermo, scala reale
			if (pixelSize >= minPixels) {
				return 1.0;
			}

			// Scala per raggiungere la dimensione minima
			const scale = minPixels / pixelSize;

			// Transizione morbida nella zona intermedia
			if (pixelSize >= minPixels * 0.5) {
				const t = (pixelSize - minPixels * 0.5) / (minPixels * 0.5);
				return 1.0 + (scale - 1.0) * (1.0 - t);
			}

			// Cap massimo di scala per evitare oggetti giganteschi da lontanissimo
			return Math.min(scale, 50000);
		}
		

        // === POST-PROCESSING (BLOOM) ===
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
        bloomPass.threshold = 0.6;
        bloomPass.strength = 1.2;
        bloomPass.radius = 0.4;
        composer.addPass(bloomPass);

        // === ORBIT CONTROLS ===
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
		controls.minDistance = 0.005;
		controls.maxDistance = 2000;
        controls.enablePan = true;

        // === STARS ===
        function createStars() {
            const geometry = new THREE.BufferGeometry();
            const count = 12000;
            const positions = new Float32Array(count * 3);
            const sizes = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                const r = 600 + Math.random() * 800;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
                positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                positions[i * 3 + 2] = r * Math.cos(phi);
                sizes[i] = 0.5 + Math.random() * 1.5;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

            const material = new THREE.PointsMaterial({
                color: 0xffffff,
                size: 0.7,
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.85
            });

            scene.add(new THREE.Points(geometry, material));
        }
        createStars();

        // === ECLIPTIC GRID ===
		function createEclipticGrid() {
			// Grid copre ~60 AU di diametro
			const gridSize = 60 * AU_SCALE;
			const grid = new THREE.GridHelper(gridSize, 60, 0x223366, 0x112244);
			grid.material.opacity = 0.12;
			grid.material.transparent = true;
			scene.add(grid);
		}
        createEclipticGrid();

		
		// === ASTEROID BELTS ===
        function createIrregularAsteroidGeometry(baseRadius) {
            const geo = new THREE.DodecahedronGeometry(baseRadius, 0); // detail 0 = meno facce, più roccioso
            const positions = geo.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i);
                const y = positions.getY(i);
                const z = positions.getZ(i);
                const noise = 0.85 + Math.random() * 0.3; // deformazione leggera: da 0.85 a 1.15
                positions.setXYZ(i, x * noise, y * noise, z * noise);
            }
            geo.computeVertexNormals();
            return geo;
        }

        function createAsteroidBelt(innerAU, outerAU, count, minSize, maxSize, ySpread) {
            const innerRadius = innerAU * AU_SCALE;
            const outerRadius = outerAU * AU_SCALE;
            const asteroidGroup = new THREE.Group();

            // Usa InstancedMesh per performance con geometria irregolare base
            // Ma per avere forme diverse, creiamo diversi template e li riusiamo
            const templateCount = 8;
            const templates = [];
            for (let t = 0; t < templateCount; t++) {
                const size = minSize + Math.random() * (maxSize - minSize);
                templates.push(createIrregularAsteroidGeometry(size));
            }

            const asteroidMaterial = new THREE.MeshStandardMaterial({
                color: 0xccbbaa,
                roughness: 0.8,
                metalness: 0.05,
                emissive: 0x222211,
                emissiveIntensity: 0.15
            });

            // Segnaposto: la texture verrà assegnata dopo il caricamento
            asteroidGroup.userData.material = asteroidMaterial;
            asteroidGroup.userData.needsTexture = true;

            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = innerRadius + Math.random() * (outerRadius - innerRadius);
                const templateIdx = Math.floor(Math.random() * templateCount);

                const mesh = new THREE.Mesh(templates[templateIdx], asteroidMaterial);

                mesh.position.x = Math.cos(angle) * dist;
                mesh.position.z = Math.sin(angle) * dist;
                mesh.position.y = (Math.random() - 0.5) * ySpread;

                // Rotazione casuale per varietà visiva
                mesh.rotation.x = Math.random() * Math.PI * 2;
                mesh.rotation.y = Math.random() * Math.PI * 2;
                mesh.rotation.z = Math.random() * Math.PI * 2;

                asteroidGroup.add(mesh);
            }

            scene.add(asteroidGroup);
            return asteroidGroup;
        }

        // Fascia principale: 2.2 - 3.2 UA, tra Marte e Giove
		const mainBelt = createAsteroidBelt(2.2, 3.2, 1200, 0.015, 0.06, 0.3 * AU_SCALE);

		// Fascia di Kuiper: 30 - 50 UA, oltre Nettuno
		const kuiperBelt = createAsteroidBelt(30, 50, 5000, 0.03, 0.12, 1.0 * AU_SCALE);
		
		
		// === TEXTURE LOADER ===
		const textureLoader = new THREE.TextureLoader();
		const originalLoad = textureLoader.load.bind(textureLoader);
		textureLoader.load = function(url, onLoad, onProgress, onError) {
			return originalLoad(
				url,
				onLoad,
				onProgress,
				onError || ((err) => {
					console.warn(`[Texture] Impossibile caricare: ${url}`, err);
				})
			);
		};

		// Preload textures (2k default, 8k for close-up)
		const textures = {
			sun: {
				low: textureLoader.load('Texture/Sun_Moon_Stars/2k_sun.jpg'),
				high: textureLoader.load('Texture/Sun_Moon_Stars/8k_sun.jpg')
			},
			mercury: {
				low: textureLoader.load('Texture/Planets/2k_mercury.jpg'),
				high: textureLoader.load('Texture/Planets/8k_mercury.jpg')
			},
			venus: {
				low: textureLoader.load('Texture/Planets/2k_venus_surface.jpg'),
				high: textureLoader.load('Texture/Planets/8k_venus_surface.jpg')
			},
			earth: {
				low: textureLoader.load('Texture/Planets/2k_earth_daymap.jpg'),
				high: textureLoader.load('Texture/Planets/8k_earth_daymap.jpg')
			},
			mars: {
				low: textureLoader.load('Texture/Planets/2k_mars.jpg'),
				high: textureLoader.load('Texture/Planets/8k_mars.jpg')
			},
			jupiter: {
				low: textureLoader.load('Texture/Planets/2k_jupiter.jpg'),
				high: textureLoader.load('Texture/Planets/8k_jupiter.jpg')
			},
			saturn: {
				low: textureLoader.load('Texture/Planets/2k_saturn.jpg'),
				high: textureLoader.load('Texture/Planets/8k_saturn.jpg')
			},
			saturnRing: {
				low: textureLoader.load('Texture/Planets/2k_saturn_ring_alpha.png'),
				high: textureLoader.load('Texture/Planets/8k_saturn_ring_alpha.png')
			},
			uranus: {
				low: textureLoader.load('Texture/Planets/2k_uranus.jpg'),
				high: null // no 8k available
			},
			neptune: {
				low: textureLoader.load('Texture/Planets/2k_neptune.jpg'),
				high: null // no 8k available
			},
			asteroid: {
				low: textureLoader.load('Texture/Sun_Moon_Stars/Generic_Celestia_asteroid_texture.jpg')
			},
			// Dwarf planets textures
			ceres: {
				low: textureLoader.load('Texture/Nano/2k_ceres_fictional.jpg'),
				high: textureLoader.load('Texture/Nano/4k_ceres_fictional.jpg')
			},
			pluto: {
				low: textureLoader.load('Texture/Nano/2k_pluto.jpg'),
				high: null // no 4k available
			},
			eris: {
				low: textureLoader.load('Texture/Nano/2k_eris_fictional.jpg'),
				high: textureLoader.load('Texture/Nano/4k_eris_fictional.jpg')
			},
			haumea: {
				low: textureLoader.load('Texture/Nano/2k_haumea_fictional.jpg'),
				high: textureLoader.load('Texture/Nano/4k_haumea_fictional.jpg')
			},
			makemake: {
				low: textureLoader.load('Texture/Nano/2k_makemake_fictional.jpg'),
				high: textureLoader.load('Texture/Nano/4k_makemake_fictional.jpg')
			},
			moon: {
				low: textureLoader.load('Texture/Sun_Moon_Stars/2k_moon.jpg'),
				high: textureLoader.load('Texture/Sun_Moon_Stars/8k_moon.jpg')
			},
		};

		// Texture key mapping per planet name
		const textureKeyMap = {
			'Mercurio': 'mercury',
			'Venere': 'venus',
			'Terra': 'earth',
			'Marte': 'mars',
			'Giove': 'jupiter',
			'Saturno': 'saturn',
			'Urano': 'uranus',
			'Nettuno': 'neptune',
			'Cerere': 'ceres',
			'Plutone': 'pluto',
			'Eris': 'eris',
			'Haumea': 'haumea',
			'Makemake': 'makemake'
		};

		// LOD distance threshold (scene units) - switch to 8k when camera is closer than this
		const LOD_THRESHOLD = 0.05;
				
		

        // === LIGHTS ===
		
		// === ASSIGN ASTEROID TEXTURE ===
        const asteroidTexture = textures.asteroid.low;
        if (mainBelt.userData.needsTexture) {
            mainBelt.userData.material.map = asteroidTexture;
            mainBelt.userData.material.needsUpdate = true;
        }
        if (kuiperBelt.userData.needsTexture) {
            kuiperBelt.userData.material.map = asteroidTexture;
            kuiperBelt.userData.material.needsUpdate = true;
        }
        scene.add(new THREE.AmbientLight(0x222233, 0.6));

		const sunLight = new THREE.PointLight(0xffffff, 1.8, 0, 0);
        sunLight.position.set(0, 0, 0);
        scene.add(sunLight);

        // === SUN ===
		const sunRadiusAU = 695700 * KM_TO_AU;
		const sunRadiusScene = sunRadiusAU * AU_SCALE;
		const sunGeo = new THREE.SphereGeometry(sunRadiusScene, 64, 64);
        
		const sunMat = new THREE.MeshBasicMaterial({ map: textures.sun.low });
		const sun = new THREE.Mesh(sunGeo, sunMat);
		sun.userData.currentLOD = 'low';
        scene.add(sun);

        // Sun glow sprite
        function makeGlowTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            grad.addColorStop(0, 'rgba(255,230,80,1)');
            grad.addColorStop(0.15, 'rgba(255,180,40,0.7)');
            grad.addColorStop(0.4, 'rgba(255,100,10,0.25)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 256, 256);
            return new THREE.CanvasTexture(canvas);
        }

		const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
			map: makeGlowTexture(),
			color: 0xffaa22,
			transparent: true,
			blending: THREE.AdditiveBlending,
			opacity: 0.5,
			depthWrite: false
		}));
        glowSprite.scale.set(sunRadiusScene * 6, sunRadiusScene * 6, 1);
        sun.add(glowSprite);

        // === PLANET DATA ===
        // radius in AU (raggio reale in km * KM_TO_AU)
		const planetData = [
		  { name: 'Mercurio', aAU: 0.387, e: 0.2056, iDeg: 7.0,  period: 87.97,   LDeg: 252.25084, varpiDeg: 77.45645, omegaDeg: 48.33167, radiusAU: 2439.7 * KM_TO_AU, color: 0xb0b0b0 },
		  { name: 'Venere',   aAU: 0.723, e: 0.0068, iDeg: 3.39, period: 224.7,   LDeg: 181.97973, varpiDeg: 131.53298, omegaDeg: 76.68069, radiusAU: 6051.8 * KM_TO_AU, color: 0xe8c56d },
		  { name: 'Terra',    aAU: 1.000, e: 0.0167, iDeg: 0.0,  period: 365.25,  LDeg: 100.46435, varpiDeg: 102.94719, omegaDeg: 0.0,     radiusAU: 6371.0 * KM_TO_AU, color: 0x4488ff },
		  { name: 'Marte',    aAU: 1.524, e: 0.0934, iDeg: 1.85, period: 687.0,   LDeg: 355.45332, varpiDeg: 336.04084, omegaDeg: 49.57854, radiusAU: 3389.5 * KM_TO_AU, color: 0xcc4422 },
		  { name: 'Giove',    aAU: 5.203, e: 0.0485, iDeg: 1.30, period: 4332.6,  LDeg: 34.40438,  varpiDeg: 14.72847, omegaDeg: 100.55615, radiusAU: 69911.0 * KM_TO_AU, color: 0xc88a50 },
		  { name: 'Saturno',  aAU: 9.537, e: 0.0556, iDeg: 2.49, period: 10759.2, LDeg: 49.94432,  varpiDeg: 92.59887, omegaDeg: 113.71504, radiusAU: 58232.0 * KM_TO_AU, color: 0xd4a84b },
		  { name: 'Urano',    aAU: 19.19, e: 0.0472, iDeg: 0.77, period: 30688.5, LDeg: 313.23218, varpiDeg: 170.95427, omegaDeg: 74.22988, radiusAU: 25362.0 * KM_TO_AU, color: 0x88ccdd },
		  { name: 'Nettuno',  aAU: 30.07, e: 0.0086, iDeg: 1.77, period: 60182.0, LDeg: 304.88003, varpiDeg: 44.96476, omegaDeg: 131.72169, radiusAU: 24622.0 * KM_TO_AU, color: 0x4466dd }
		];

        const planets = [];

        planetData.forEach((data, idx) => {
            const a = data.aAU * AU_SCALE; // semi-major axis in scene units
            const b = a * Math.sqrt(1 - data.e * data.e); // semi-minor axis
            const c = a * data.e; // focus offset
            const inclination = THREE.MathUtils.degToRad(data.iDeg);

            // Planet mesh
            const geo = new THREE.SphereGeometry(data.radiusAU * AU_SCALE, 32, 32);
            const texKey = textureKeyMap[data.name];
			const planetTexture = textures[texKey] ? textures[texKey].low : null;
			const mat = new THREE.MeshStandardMaterial({
				map: planetTexture,
				color: planetTexture ? 0xffffff : data.color,
				roughness: 0.9,
				metalness: 0.1
			});
            const mesh = new THREE.Mesh(geo, mat);
			mesh.userData.currentLOD = 'low';
            scene.add(mesh);

			// Saturn rings
			if (data.name === 'Saturno') {
				// Anelli: da 66,900 km a 140,220 km dal centro
				const ringInner = 66900 * KM_TO_AU * AU_SCALE;
				const ringOuter = 140220 * KM_TO_AU * AU_SCALE;
				const ringGeo = new THREE.RingGeometry(ringInner, ringOuter, 64);
				
				
				// Fix UVs for ring geometry to map texture correctly
				const pos = ringGeo.attributes.position;
				const uv = ringGeo.attributes.uv;
				for (let i = 0; i < pos.count; i++) {
					const x = pos.getX(i);
					const y = pos.getY(i);
					const dist = Math.sqrt(x * x + y * y);
					const normalizedDist = (dist - ringInner) / (ringOuter - ringInner);
					uv.setXY(i, normalizedDist, normalizedDist);
				}
				const ringMat = new THREE.MeshBasicMaterial({
					map: textures.saturnRing.low,
					side: THREE.DoubleSide,
					transparent: true,
					opacity: 0.7
				});
				const ring = new THREE.Mesh(ringGeo, ringMat);
				ring.rotation.x = Math.PI / 2.2;
				ring.userData.currentLOD = 'low';
				mesh.add(ring);
			}

            // Orbit path (ellipse)
			const orbitGroup = new THREE.Group(); // niente rotation.x: le rotazioni sono già nei punti
			scene.add(orbitGroup);

			const orbitVecs = buildOrbitPoints({
			  a, b, e: data.e,
			  inclination,
			  varpiDeg: data.varpiDeg,
			  omegaDeg: data.omegaDeg
			}, 256);
			const orbitPoints = orbitVecs; // per compatibilità con il codice colori sotto
			const orbitGeo3D = new THREE.BufferGeometry().setFromPoints(orbitVecs);

			// Vertex colors: arco parziale con fade
			const orbitColorArray = new Float32Array(orbitPoints.length * 3);
			const phaseOffset = idx * 0.7; // ogni pianeta ha l'arco sfasato
			for (let i = 0; i < orbitPoints.length; i++) {
				const t = i / orbitPoints.length;
				const fade = Math.pow(Math.max(0, Math.sin((t + phaseOffset) * Math.PI)), 2.0);
				orbitColorArray[i * 3] = fade;
				orbitColorArray[i * 3 + 1] = fade;
				orbitColorArray[i * 3 + 2] = fade;
			}
			orbitGeo3D.setAttribute('color', new THREE.Float32BufferAttribute(orbitColorArray, 3));

			const orbitLine = new THREE.Line(orbitGeo3D, new THREE.LineBasicMaterial({
				color: 0x7dd3fc,
				transparent: true,
				opacity: 0.25,
				vertexColors: true
			}));
			orbitGroup.add(orbitLine);

            // Store planet info
			planets.push({
				mesh, a, b, c, e: data.e, inclination,
				period: data.period,
				LDeg: data.LDeg, varpiDeg: data.varpiDeg, omegaDeg: data.omegaDeg,
				name: data.name,
				texKey: textureKeyMap[data.name],
				realRadius: data.radiusAU * AU_SCALE, // raggio reale in unità scena
			});
        });
		
		// === DWARF PLANETS ===
		const dwarfPlanetData = [
		  { name: 'Cerere',   aAU: 2.77,  e: 0.0758, iDeg: 10.59, period: 1681.63,  LDeg: 95.99,  varpiDeg: 73.6,  omegaDeg: 80.31,  radiusAU: 473.0 * KM_TO_AU,  color: 0xaaaaaa },
		  { name: 'Plutone',  aAU: 39.48, e: 0.2488, iDeg: 17.16, period: 90560.0,  LDeg: 238.93, varpiDeg: 224.07, omegaDeg: 110.30, radiusAU: 1188.3 * KM_TO_AU, color: 0xc8a882 },
		  { name: 'Eris',     aAU: 67.67, e: 0.4407, iDeg: 44.04, period: 203830.0, LDeg: 204.16, varpiDeg: 187.15, omegaDeg: 35.95,  radiusAU: 1163.0 * KM_TO_AU, color: 0xdddddd },
		  { name: 'Haumea',   aAU: 43.13, e: 0.1912, iDeg: 28.22, period: 103468.0, LDeg: 209.07, varpiDeg: 240.20, omegaDeg: 121.90, radiusAU: 816.0 * KM_TO_AU,  color: 0xddbbbb },
		  { name: 'Makemake', aAU: 45.79, e: 0.1559, iDeg: 28.96, period: 113183.0, LDeg: 165.51, varpiDeg: 294.83, omegaDeg: 79.62,  radiusAU: 715.0 * KM_TO_AU,  color: 0xcc9966 }
		];

		const dwarfPlanets = [];

		dwarfPlanetData.forEach((data) => {
			const a = data.aAU * AU_SCALE;
			const b = a * Math.sqrt(1 - data.e * data.e);
			const c = a * data.e;
			const inclination = THREE.MathUtils.degToRad(data.iDeg);

			// Dwarf planet mesh
			const geo = new THREE.SphereGeometry(data.radiusAU * AU_SCALE, 24, 24);
			const texKey = textureKeyMap[data.name];
			const dwarfTexture = textures[texKey] ? textures[texKey].low : null;
			const mat = new THREE.MeshStandardMaterial({
				map: dwarfTexture,
				color: dwarfTexture ? 0xffffff : data.color,
				roughness: 0.8,
				metalness: 0.05
			});
			const mesh = new THREE.Mesh(geo, mat);
			mesh.userData.currentLOD = 'low';
			scene.add(mesh);

			// Orbit path (ellipse) 
			const orbitGroup = new THREE.Group();
			scene.add(orbitGroup);

			const orbitVecs = buildOrbitPoints({
			  a, b, e: data.e,
			  inclination,
			  varpiDeg: data.varpiDeg,
			  omegaDeg: data.omegaDeg
			}, 256);
			const orbitPoints = orbitVecs;
			const orbitGeo3D = new THREE.BufferGeometry().setFromPoints(orbitVecs);

			// Vertex colors: arco parziale con fade
			const orbitColorArray = new Float32Array(orbitPoints.length * 3);
			const phaseOffset = Math.random() * 2;
			for (let i = 0; i < orbitPoints.length; i++) {
				const t = i / orbitPoints.length;
				const fade = Math.pow(Math.max(0, Math.sin((t + phaseOffset) * Math.PI)), 2.0);
				orbitColorArray[i * 3] = fade;
				orbitColorArray[i * 3 + 1] = fade;
				orbitColorArray[i * 3 + 2] = fade;
			}
			orbitGeo3D.setAttribute('color', new THREE.Float32BufferAttribute(orbitColorArray, 3));

			const orbitLine = new THREE.Line(orbitGeo3D, new THREE.LineBasicMaterial({
				color: 0x7dd3fc,
				transparent: true,
				opacity: 0.18,
				vertexColors: true
			}));
			orbitGroup.add(orbitLine);

			// Store dwarf planet info
			dwarfPlanets.push({
				mesh, a, b, c, e: data.e, inclination,
				period: data.period,
				LDeg: data.LDeg, varpiDeg: data.varpiDeg, omegaDeg: data.omegaDeg,
				name: data.name,
				texKey: textureKeyMap[data.name],
				realRadius: data.radiusAU * AU_SCALE,
			});
		});
		
		// === NATURAL SATELLITES ===
		// aAU = semiasse maggiore in AU, radiusAU = raggio in AU
		const satelliteData = {
			'Terra': [
				{ name: 'Luna', aAU: 384400 * KM_TO_AU, e: 0.0549, iDeg: 5.145, period: 27.322, radiusAU: 1737.4 * KM_TO_AU, color: 0xcccccc, textured: true }
			],
			'Marte': [
				{ name: 'Phobos', aAU: 9376 * KM_TO_AU, e: 0.0151, iDeg: 1.093, period: 0.3189, radiusAU: 11.27 * KM_TO_AU, color: 0x998877 },
				{ name: 'Deimos', aAU: 23463 * KM_TO_AU, e: 0.0002, iDeg: 0.93, period: 1.2624, radiusAU: 6.2 * KM_TO_AU, color: 0x887766 }
			],
			'Giove': [
				{ name: 'Io', aAU: 421700 * KM_TO_AU, e: 0.0041, iDeg: 0.05, period: 1.769, radiusAU: 1821.6 * KM_TO_AU, color: 0xddcc44 },
				{ name: 'Europa', aAU: 671034 * KM_TO_AU, e: 0.009, iDeg: 0.47, period: 3.551, radiusAU: 1560.8 * KM_TO_AU, color: 0xccbbaa },
				{ name: 'Ganimede', aAU: 1070412 * KM_TO_AU, e: 0.0013, iDeg: 0.18, period: 7.155, radiusAU: 2634.1 * KM_TO_AU, color: 0x998877 },
				{ name: 'Callisto', aAU: 1882709 * KM_TO_AU, e: 0.0074, iDeg: 0.19, period: 16.689, radiusAU: 2410.3 * KM_TO_AU, color: 0x665544 },
				{ name: 'Amaltea', aAU: 181366 * KM_TO_AU, e: 0.003, iDeg: 0.38, period: 0.498, radiusAU: 83.5 * KM_TO_AU, color: 0xaa6644 }
			],
			'Saturno': [
				{ name: 'Mimante', aAU: 185539 * KM_TO_AU, e: 0.0196, iDeg: 1.574, period: 0.942, radiusAU: 198.2 * KM_TO_AU, color: 0xcccccc },
				{ name: 'Encelado', aAU: 238042 * KM_TO_AU, e: 0.0047, iDeg: 0.009, period: 1.370, radiusAU: 252.1 * KM_TO_AU, color: 0xeeeeff },
				{ name: 'Teti', aAU: 294619 * KM_TO_AU, e: 0.0001, iDeg: 1.12, period: 1.888, radiusAU: 531.1 * KM_TO_AU, color: 0xdddddd },
				{ name: 'Dione', aAU: 377396 * KM_TO_AU, e: 0.0022, iDeg: 0.019, period: 2.737, radiusAU: 561.4 * KM_TO_AU, color: 0xccccbb },
				{ name: 'Rea', aAU: 527108 * KM_TO_AU, e: 0.0013, iDeg: 0.345, period: 4.518, radiusAU: 763.8 * KM_TO_AU, color: 0xbbbbaa },
				{ name: 'Titano', aAU: 1221870 * KM_TO_AU, e: 0.0288, iDeg: 0.34, period: 15.945, radiusAU: 2574.7 * KM_TO_AU, color: 0xdd9944 },
				{ name: 'Giapeto', aAU: 3560820 * KM_TO_AU, e: 0.0286, iDeg: 15.47, period: 79.322, radiusAU: 734.5 * KM_TO_AU, color: 0x887766 },
				{ name: 'Elena', aAU: 377396 * KM_TO_AU, e: 0.012, iDeg: 0.213, period: 2.737, radiusAU: 17.6 * KM_TO_AU, color: 0xaaaaaa }
			],
			'Urano': [
				{ name: 'Ariel', aAU: 190900 * KM_TO_AU, e: 0.0012, iDeg: 0.26, period: 2.520, radiusAU: 578.9 * KM_TO_AU, color: 0xbbcccc },
				{ name: 'Umbriel', aAU: 266000 * KM_TO_AU, e: 0.0039, iDeg: 0.128, period: 4.144, radiusAU: 584.7 * KM_TO_AU, color: 0x777788 },
				{ name: 'Titania', aAU: 436300 * KM_TO_AU, e: 0.0011, iDeg: 0.34, period: 8.706, radiusAU: 788.9 * KM_TO_AU, color: 0xaabbaa },
				{ name: 'Oberon', aAU: 583500 * KM_TO_AU, e: 0.0014, iDeg: 0.058, period: 13.463, radiusAU: 761.4 * KM_TO_AU, color: 0x998888 },
				{ name: 'Miranda', aAU: 129390 * KM_TO_AU, e: 0.0013, iDeg: 4.232, period: 1.413, radiusAU: 235.8 * KM_TO_AU, color: 0xaaaaaa }
			],
			'Nettuno': [
				{ name: 'Tritone', aAU: 354759 * KM_TO_AU, e: 0.000016, iDeg: 156.885, period: 5.877, radiusAU: 1353.4 * KM_TO_AU, color: 0xaabbcc },
				{ name: 'Nereide', aAU: 5513818 * KM_TO_AU, e: 0.7507, iDeg: 7.23, period: 360.14, radiusAU: 170.0 * KM_TO_AU, color: 0x999999 },
				{ name: 'Naiade', aAU: 48227 * KM_TO_AU, e: 0.0003, iDeg: 4.75, period: 0.294, radiusAU: 33.0 * KM_TO_AU, color: 0x888888 },
				{ name: 'Talassa', aAU: 50075 * KM_TO_AU, e: 0.0002, iDeg: 0.21, period: 0.311, radiusAU: 41.0 * KM_TO_AU, color: 0x888899 },
				{ name: 'Despina', aAU: 52526 * KM_TO_AU, e: 0.0001, iDeg: 0.07, period: 0.335, radiusAU: 75.0 * KM_TO_AU, color: 0x889988 }
			]
		};

		const satelliteDataPlutone = [
			{ name: 'Caronte', aAU: 19591 * KM_TO_AU, e: 0.0002, iDeg: 0.08, period: 6.387, radiusAU: 606.0 * KM_TO_AU, color: 0x999988 }
		];

		const satellites = [];
		const satelliteGenericTexture = textures.asteroid.low;

		function createSatellitesForBody(parentMesh, parentName, satDataArray) {
			satDataArray.forEach(satData => {
				const a = satData.aAU * AU_SCALE;
				const b = a * Math.sqrt(1 - satData.e * satData.e);
				const c = a * satData.e;
				const inclination = THREE.MathUtils.degToRad(satData.iDeg);

				// Satellite mesh
				const geo = new THREE.SphereGeometry(satData.radiusAU * AU_SCALE, 16, 16);
				let mat;
				if (satData.textured && satData.name === 'Luna') {
					mat = new THREE.MeshStandardMaterial({
						map: textures.moon.low,
						roughness: 0.8,
						metalness: 0.05
					});
				} else {
					mat = new THREE.MeshStandardMaterial({
						map: satelliteGenericTexture,
						color: satData.color,
						roughness: 0.85,
						metalness: 0.05
					});
				}
				const mesh = new THREE.Mesh(geo, mat);
				mesh.userData.currentLOD = 'low';
				scene.add(mesh);

				// Orbit line
				const orbitGroup = new THREE.Group();
				scene.add(orbitGroup);

				const orbitCurve = new THREE.EllipseCurve(
					-c, 0,
					a, b,
					0, 2 * Math.PI,
					false, 0
				);
				const orbitPoints = orbitCurve.getPoints(128);
				const orbitGeo3D = new THREE.BufferGeometry().setFromPoints(
					orbitPoints.map(p => new THREE.Vector3(p.x, 0, p.y))
				);

				// Vertex colors: arco parziale con fade
				const satOrbitColors = new Float32Array(orbitPoints.length * 3);
				const satPhase = Math.random() * 2;
				for (let i = 0; i < orbitPoints.length; i++) {
					const t = i / orbitPoints.length;
					const fade = Math.pow(Math.max(0, Math.sin((t + satPhase) * Math.PI)), 2.0);
					satOrbitColors[i * 3] = fade;
					satOrbitColors[i * 3 + 1] = fade;
					satOrbitColors[i * 3 + 2] = fade;
				}
				orbitGeo3D.setAttribute('color', new THREE.Float32BufferAttribute(satOrbitColors, 3));

				const orbitLine = new THREE.Line(orbitGeo3D, new THREE.LineBasicMaterial({
					color: 0x7dd3fc,
					transparent: true,
					opacity: 0.15,
					vertexColors: true
				}));
				orbitGroup.add(orbitLine);
				orbitGroup.rotation.x = inclination;

				satellites.push({
					mesh,
					orbitGroup,
					a,
					b,
					c,
					inclination,
					period: satData.period,
					name: satData.name,
					parentName,
					parentMesh,
					realRadius: satData.radiusAU * AU_SCALE,
					phase: Math.random() * Math.PI * 2,
					isLuna: satData.name === 'Luna'
				});
			});
		}

		// Create satellites for planets
		planets.forEach(planet => {
			if (satelliteData[planet.name]) {
				createSatellitesForBody(planet.mesh, planet.name, satelliteData[planet.name]);
			}
		});

		// Create satellites for Plutone (dwarf planet)
		const plutoObj = dwarfPlanets.find(p => p.name === 'Plutone');
		if (plutoObj) {
			createSatellitesForBody(plutoObj.mesh, 'Plutone', satelliteDataPlutone);
		}

        // === TIME CONTROLS ===
        let isPlaying = true;
        let speedMultiplier = 1.0;
        let simulatedDays = 0;
		const SIM_START_DATE = new Date(); // data odierna
		const J2000 = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));  // epoca di riferimento
		const daysFromJ2000 = (SIM_START_DATE.getTime() - J2000.getTime()) / 86400000;

		
		
		
		
		

		const playBtn = document.getElementById('play-btn');
		const playIcon = document.getElementById('play-icon');
		const speedControl = document.getElementById('speed-control');
		const speeds = [0.1, 0.5, 1, 2, 5, 10, 20, 50];
		let speedIdx = 2; // parte da 1x

		playBtn.addEventListener('click', () => {
			isPlaying = !isPlaying;
			if (isPlaying) {
				playIcon.innerHTML = '<polygon points="8,5 19,12 8,19"/>';
			} else {
				playIcon.innerHTML = '<rect x="7" y="5" width="3" height="14"/><rect x="14" y="5" width="3" height="14"/>';
			}
		});

		speedControl.addEventListener('click', () => {
			speedIdx = (speedIdx + 1) % speeds.length;
			speedMultiplier = speeds[speedIdx];
			speedControl.innerHTML = '<span>' + speeds[speedIdx] + '</span>x';
		});
		
		const timelineTrack = document.getElementById('timeline-track');
		const timelineFill = document.getElementById('timeline-fill');

		timelineTrack.addEventListener('click', (e) => {
			const rect = timelineTrack.getBoundingClientRect();
			const ratio = (e.clientX - rect.left) / rect.width;
			// Permette di saltare avanti/indietro nel tempo simulato
			// Mappiamo 0-100% su 0-365 giorni (un anno)
			simulatedDays = ratio * 365.25 * speedMultiplier;
		});
		

        // === RESIZE ===
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        });

        // === ANIMATION LOOP ===
        const clock = new THREE.Clock();

		
		
		// === SEARCH & TRACKING SYSTEM ===
		const searchInput = document.getElementById('search-input');
		const searchSuggestions = document.getElementById('search-suggestions');
		const searchStatus = document.getElementById('search-status');
		const trackingIndicator = document.getElementById('tracking-indicator');
		const trackingName = document.getElementById('tracking-name');
		const stopTrackingBtn = document.getElementById('stop-tracking');

		// Searchable objects catalog
		const searchableObjects = [
			{ name: 'Sole', aliases: ['sun', 'stella'], icon: '☀️', type: 'star', getPosition: () => sun.position.clone() },
			...planets.map(p => ({
				name: p.name,
				aliases: [p.name.toLowerCase()],
				icon: '🪐',
				type: 'planet',
				getPosition: () => p.mesh.position.clone()
			})),
			...dwarfPlanets.map(p => ({
				name: p.name,
				aliases: [p.name.toLowerCase(), 'nano ' + p.name.toLowerCase()],
				icon: '🔹',
				type: 'dwarf',
				getPosition: () => p.mesh.position.clone()
			}))
		];

		// Deep sky objects (approximate positions for educational purposes)
		const deepSkyObjects = [
			{ name: 'M31 - Andromeda', aliases: ['m31', 'andromeda'], icon: '🌌', type: 'deepsky', getPosition: () => new THREE.Vector3(400, 50, -200) },
			{ name: 'M42 - Nebulosa di Orione', aliases: ['m42', 'orione', 'orion'], icon: '🌌', type: 'deepsky', getPosition: () => new THREE.Vector3(-300, -30, 350) },
			{ name: 'M45 - Pleiadi', aliases: ['m45', 'pleiadi', 'pleiades'], icon: '✨', type: 'deepsky', getPosition: () => new THREE.Vector3(200, 80, 300) },
		];
		searchableObjects.push(...deepSkyObjects);
		
		deepSkyObjects.forEach(dso => {
		const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
			color: 0xaaccff,
			transparent: true,
			opacity: 0.4,
			blending: THREE.AdditiveBlending
		}));
		const pos = dso.getPosition();
		sprite.position.copy(pos);
		sprite.scale.set(5, 5, 1);
		scene.add(sprite);
	});
		
		// Add satellites to searchable objects
		satellites.forEach(sat => {
			searchableObjects.push({
				name: sat.name,
				aliases: [sat.name.toLowerCase()],
				icon: '🌙',
				type: 'satellite',
				getPosition: () => sat.mesh.position.clone()
			});
		});
		
		

		// Tracking state
		let trackingTarget = null;
		let isAnimatingCamera = false;
		let cameraAnimStart = null;
		let cameraAnimDuration = 1500; // ms
		let cameraStartPos = new THREE.Vector3();
		let cameraEndOffset = new THREE.Vector3();
		let userInterrupted = false;
		let trackingMode = 'observe'; // 'observe' = camera fissa che guarda, 'follow' = camera segue l'oggetto
		let pendingFollowTransition = false; // true quando stiamo animando verso follow dopo un click
		
		
		// === OBSERVE DINAMICO ===
		let observeAnchorPos = new THREE.Vector3();   // posizione base (ferma) della camera in observe
		let observeTangentDir = new THREE.Vector3();  // direzione di marcia dell'oggetto lungo l'orbita
		let observeAngleStart = 0;                     // angolo dell'oggetto al momento dell'aggancio
		let observeUserZoom = 1.0;                     // fattore di zoom dell'utente (1 = distanza base)
		let observeOffRadial = 0;
		let observeOffTangent = 0;
		let observeOffUp = 0;
		const OBSERVE_RELEASE = Math.PI * 0.28;        // soglia oltre cui la camera inizia a inseguire
		const OBSERVE_CHASE_FACTOR = 0.55;             // <1: la camera resta più lenta dell'oggetto
		const OBSERVE_SMOOTH = 0.04;                   // morbidezza del movimento della camera
		let observeStartTime = 0;               // istante di aggancio (per il timing delle fasi)
		const OBSERVE_PHASE12_DURATION = 4.0;   // secondi di camera ferma prima dell'inseguimento
		let observePhase = 'TRANSIT';               // 'TRANSIT' (camera ferma) | 'CHASE' (inseguimento)
		let observeFixedPos = new THREE.Vector3();  // posizione fissa camera durante il transito
		let chaseDist = 0;                          // distanza di inseguimento in fase CHASE

		function getSearchResults(query) {
			if (!query || query.length === 0) return [];
			const q = query.toLowerCase().trim();
			return searchableObjects.filter(obj => {
				if (obj.name.toLowerCase().includes(q)) return true;
				return obj.aliases.some(a => a.includes(q));
			});
		}
		
		
		// === PARSING SEMANTICO DELLE QUERY (via Ollama) ===
		async function resolveQuerySemantic(query) {
			// Nomi esatti disponibili nel catalogo, da passare all'AI come vincolo
			const catalog = searchableObjects.map(o => o.name);

			const system = `Sei un interprete di comandi per un simulatore 3D del Sistema Solare.
		L'utente scrive una richiesta in linguaggio naturale. Devi individuare UN SOLO corpo celeste
		tra quelli disponibili e restituirlo. Rispondi SOLO con JSON valido nel formato:
		{"target":"<nome esatto dalla lista>","found":true}
		oppure {"target":null,"found":false} se nessuno corrisponde.
		Il campo "target" DEVE essere IDENTICO a uno dei nomi della lista fornita, rispettando maiuscole e accenti.
		Conoscenze utili: la luna più grande di Giove è Ganimede; la più grande di Saturno è Titano;
		la più grande di Nettuno è Tritone; la luna della Terra è la Luna.
		Il pianeta più grande è Giove; il più piccolo è Mercurio; il più caldo è Venere;
		il pianeta rosso è Marte; il gigante con gli anelli è Saturno.`;

			const prompt = `Corpi disponibili (usa ESATTAMENTE questi nomi): ${catalog.join(', ')}.
		Richiesta utente: "${query}".`;

			const res = await AI.ask({
				prompt,
				system,
				json: true,
				useCache: true,
				timeout: 30000
			});

			// Validazione rigorosa: il target deve esistere davvero nel catalogo
			if (res && res.found && res.target) {
				const match = searchableObjects.find(
					o => o.name.toLowerCase() === String(res.target).toLowerCase()
				);
				if (match) return match.name;
			}
			return null;
		}
		

		function showSuggestions(results) {
			if (results.length === 0) {
				searchSuggestions.classList.remove('visible');
				return;
			}
			searchSuggestions.innerHTML = results.map(r =>
				`<div class="suggestion-item" data-name="${r.name}">
					<span class="sg-icon">${r.icon}</span>
					<span>${r.name}</span>
				</div>`
			).join('');
			searchSuggestions.classList.add('visible');

			// Click handlers
			searchSuggestions.querySelectorAll('.suggestion-item').forEach(el => {
				el.addEventListener('click', () => {
					const name = el.getAttribute('data-name');
					searchInput.value = name;
					searchSuggestions.classList.remove('visible');
					navigateToObject(name);
				});
			});
		}

		function showStatus(msg, duration = 2500) {
			searchStatus.textContent = msg;
			searchStatus.classList.add('visible');
			setTimeout(() => searchStatus.classList.remove('visible'), duration);
		}
		
		
		// === GUIDA TURISTICA AI ===
		const staticDescriptions = {
		  'Sole': 'La stella al centro del Sistema Solare: contiene il 99,8% della massa totale del sistema.',
		  'Mercurio': 'Il pianeta più piccolo e più vicino al Sole, con enormi escursioni termiche.',
		  'Venere': 'Avvolto da una densa atmosfera di CO₂, è il pianeta più caldo del Sistema Solare.',
		  'Terra': 'L\'unico pianeta conosciuto ad ospitare la vita, con acqua liquida in superficie.',
		  'Marte': 'Il pianeta rosso, con la montagna più alta del Sistema Solare, l\'Olympus Mons.',
		  'Giove': 'Il gigante gassoso più grande, celebre per la sua Grande Macchia Rossa.',
		  'Saturno': 'Famoso per il suo spettacolare sistema di anelli fatti di ghiaccio e roccia.',
		  'Urano': 'Un gigante ghiacciato che ruota "sdraiato" sul suo asse orbitale.',
		  'Nettuno': 'Il pianeta più esterno, con i venti più veloci del Sistema Solare.'
		};

		let narrationSignal = null; // per annullare la narrazione al cambio oggetto
		
		
		function sanitizeLLM(text) {
			return text
				.replace(/<\/?(?:backspace|eos|bos|pad|unk|end_of_turn|start_of_turn|s)>/gi, '')
				.replace(/<\|[^|>]*\|>/g, '')   // token tipo <|...|>
				.replace(/<[^>\n]{1,40}>/g, '') // tag brevi residui
				.replace(/[ \t]{2,}/g, ' ');
		}
		

		function buildPrompt(obj) {
		  let details = `Nome: ${obj.name}.`;
		  const pd = planetData.find(d => d.name === obj.name)
				  || dwarfPlanetData.find(d => d.name === obj.name);
		  const s = satellites.find(x => x.name === obj.name);
		  if (pd) {
			details += ` Distanza dal Sole: ${pd.aAU} UA. Raggio: ${(pd.radiusAU / KM_TO_AU).toFixed(0)} km. Periodo orbitale: ${pd.period} giorni.`;
		  } else if (s) {
			details += ` Satellite di ${s.parentName}. Periodo orbitale: ${s.period} giorni.`;
		  } else if (obj.name === 'Sole') {
			details += ` È la stella centrale del Sistema Solare.`;
		  }
		  return `Descrivi in italiano il seguente corpo celeste per un visitatore curioso. Scrivi in modo scorrevole affascinante ed entusiasta. Aggiungi una curiosità \n${details}`;
		}

		async function narrateObject(obj) {
		  const statusEl = document.getElementById('ai-status');
		  const bodyEl = document.getElementById('ai-narration');
		  const panel = document.getElementById('ai-panel');
		  panel.classList.add('visible');
		  panel.classList.add('generating');

		  // AI disattiva → fallback statico, nessuna chiamata a Ollama
		  if (!AI.enabled) {
			statusEl.textContent = 'AI offline';
			const fallback = staticDescriptions[obj.name] || `${obj.name}: descrizione AI non disponibile.`;
			bodyEl.textContent = fallback;
			TTS.speak(fallback);
			return;
		  }

		  // annulla eventuale narrazione precedente ancora in corso
		  if (narrationSignal) narrationSignal.abort();
		  narrationSignal = new AbortController();

		  bodyEl.textContent = '';
		  statusEl.textContent = 'genero…';

		  try {
		   let lastSpokenIndex = 0; // quanti caratteri di 'full' sono già stati letti

			await AI.ask({
			  system: 'Sei una guida spaziale entusiasta e sintetica. Rispondi in italiano, 2-3 frasi, max 60 parole, senza elenchi.',
			  prompt: buildPrompt(obj),
			  stream: true,
			  signal: narrationSignal.signal,
			  onChunk: (_piece, full) => {
			    const clean = sanitizeLLM(full);
				bodyEl.textContent = clean;

				// Legge le frasi complete non ancora pronunciate
				const pending = clean.slice(lastSpokenIndex);
				// Trova l'ultima punteggiatura di fine frase nel testo pendente
				const match = pending.match(/[^.!?…]*[.!?…]+/g);
				if (match) {
				  const completeSentences = match.join('');
				  if (completeSentences.trim()) {
					TTS.speakChunk(completeSentences);
					lastSpokenIndex += completeSentences.length;
				  }
				}
			  }
			});

			panel.classList.remove('generating');
			statusEl.textContent = 'AI';

			// Legge l'eventuale coda residua (testo dopo l'ultima frase completa)
			const remaining = bodyEl.textContent.slice(lastSpokenIndex);
			if (remaining.trim()) {
			  TTS.speakChunk(remaining);
			}	
					
		  } catch (e) {
			panel.classList.remove('generating');
			if (e.name === 'AbortError') return; // cambio oggetto: normale
			console.warn('[AI] narrazione fallita:', e);
			bodyEl.textContent = staticDescriptions[obj.name] || `${obj.name}.`;
			statusEl.textContent = 'AI offline';
		  }
		}
		
		
		
		
		
		function updateInfoCard(obj) {
			const panel = document.getElementById('info-panel');
			const nameEl = document.getElementById('info-name');
			const typeEl = document.getElementById('info-type');
			const distEl = document.getElementById('info-distance');
			const radiusEl = document.getElementById('info-radius');
			const periodEl = document.getElementById('info-period');
			const speedEl = document.getElementById('info-speed');

			let data = null;

			// Cerca tra pianeti
			const p = planets.find(pl => pl.name === obj.name);
			if (p) {
				const pd = planetData.find(d => d.name === obj.name);
				data = {
					type: 'Pianeta',
					distance: pd.aAU.toFixed(2),
					radius: (pd.radiusAU / KM_TO_AU).toFixed(0),
					period: pd.period.toFixed(1),
					speed: ((2 * Math.PI * pd.aAU * 149597870.7) / (pd.period * 86400)).toFixed(2)
				};
			}

			// Cerca tra pianeti nani
			const d = dwarfPlanets.find(dp => dp.name === obj.name);
			if (d) {
				const dd = dwarfPlanetData.find(x => x.name === obj.name);
				data = {
					type: 'Pianeta nano',
					distance: dd.aAU.toFixed(2),
					radius: (dd.radiusAU / KM_TO_AU).toFixed(0),
					period: dd.period.toFixed(1),
					speed: ((2 * Math.PI * dd.aAU * 149597870.7) / (dd.period * 86400)).toFixed(2)
				};
			}

			// Cerca tra satelliti
			const s = satellites.find(sa => sa.name === obj.name);
			if (s) {
				data = {
					type: `Satellite di ${s.parentName}`,
					distance: (s.a / AU_SCALE).toFixed(5),
					radius: (s.realRadius / AU_SCALE / KM_TO_AU).toFixed(0),
					period: s.period.toFixed(2),
					speed: '—'
				};
			}

			// Sole
			if (obj.name === 'Sole') {
				data = {
					type: 'Stella',
					distance: '0',
					radius: '695700',
					period: '—',
					speed: '—'
				};
			}

			if (data) {
				nameEl.textContent = obj.name;
				typeEl.textContent = data.type;
				distEl.innerHTML = data.distance + '<span class="info-data-unit">AU</span>';
				radiusEl.innerHTML = Number(data.radius).toLocaleString() + '<span class="info-data-unit">km</span>';
				periodEl.innerHTML = data.period + '<span class="info-data-unit">giorni</span>';
				speedEl.innerHTML = data.speed + '<span class="info-data-unit">km/s</span>';
				panel.classList.add('visible');
				narrateObject(obj);
				
			}
		}
		
		
		
		

		function navigateToObject(name) {
			const obj = searchableObjects.find(o => o.name === name);
			if (!obj) {
				showStatus('⚠ OGGETTO NON TROVATO');
				return;
			}

			trackingTarget = obj;
			userInterrupted = false;

			const targetPos = obj.getPosition();
			let offsetDist = 0.01;
			if (obj.type === 'star') {
				offsetDist = sunRadiusScene * 5;
			} else if (obj.type === 'planet') {
				const pObj = planets.find(p => p.name === name);
				if (pObj) {
					const fovRad = THREE.MathUtils.degToRad(camera.fov);
					const desiredAngularSize = fovRad * 0.45;
					offsetDist = pObj.realRadius / Math.tan(desiredAngularSize / 2);
					offsetDist = Math.max(offsetDist, pObj.realRadius * 3);
				}
			} else if (obj.type === 'dwarf') {
				const dObj = dwarfPlanets.find(p => p.name === name);
				if (dObj) {
					const fovRad = THREE.MathUtils.degToRad(camera.fov);
					const desiredAngularSize = fovRad * 0.45;
					offsetDist = dObj.realRadius / Math.tan(desiredAngularSize / 2);
					offsetDist = Math.max(offsetDist, dObj.realRadius * 3);
				}
			} else if (obj.type === 'satellite') {
				const satObj = satellites.find(s => s.name === name);
				if (satObj) {
					const fovRad = THREE.MathUtils.degToRad(camera.fov);
					const desiredAngularSize = fovRad * 0.45;
					offsetDist = satObj.realRadius / Math.tan(desiredAngularSize / 2);
					offsetDist = Math.max(offsetDist, satObj.realRadius * 3);
				}
			} else if (obj.type === 'deepsky') {
				offsetDist = 50;
			}
			offsetDist = Math.max(offsetDist, 0.00003);
			controls.minDistance = Math.max(offsetDist * 0.1, 0.0001);

			const sunPos = new THREE.Vector3(0, 0, 0);
			const dirToSun = sunPos.clone().sub(targetPos).normalize();

			// Se l'oggetto È il Sole, usa un offset arbitrario
			if (obj.type === 'star') {
				cameraEndOffset = new THREE.Vector3(
					offsetDist * 0.3,
					offsetDist * 0.4,
					offsetDist * 0.85
				);
			} else {
				// Per la modalità OBSERVE: camera perpendicolare all'orbita (sopra e laterale)
				// così l'oggetto passa davanti in modo cinematografico senza sfrecciare
				
				// Direzione tangente all'orbita (perpendicolare al raggio dal sole)
				const radialDir = targetPos.clone().normalize(); // direzione radiale (dal sole all'oggetto)
				const tangentDir = new THREE.Vector3(-radialDir.z, 0, radialDir.x).normalize(); // tangente orizzontale
				const upDir = new THREE.Vector3(0, 1, 0);
				
				// Camera FUORI dal piano di marcia: radiale (esterno) + un po' dall'alto.
				// NIENTE componente tangenziale: così il pianeta scorre di lato nell'inquadratura.
				const cameraDir = radialDir.clone().multiplyScalar(0.90)
				  .add(upDir.clone().multiplyScalar(0.30))
				  .normalize();
				
				// Distanza maggiore per observe: 1.3x l'offset normale, così si vede l'arco orbitale
				const observeDist = offsetDist * 1.3;
				cameraEndOffset = cameraDir.multiplyScalar(observeDist);
				
				observePhase = 'TRANSIT';
				chaseDist = observeDist * 2;   // insegue da più lontano -> resta visibile il sistema
				
				// Camera spostata "a sinistra" dell'orbita: sinistra = tangente × up
			//	const leftDir = tangentDir.clone().cross(upDir).normalize();
			//	cameraEndOffset.add(leftDir.multiplyScalar(observeDist * 0.6));

				// Salva stato per l'observe dinamico
				observeTangentDir.copy(tangentDir);
				observeAngleStart = Math.atan2(radialDir.z, radialDir.x);
				observeUserZoom = 1.0;
				controls.enableZoom = false; // lo zoom in observe lo gestiamo con observeUserZoom
				
				
			}

			cameraStartPos.copy(camera.position);
			cameraAnimStart = performance.now();
			isAnimatingCamera = true;
			trackingMode = 'observe'; // dalla ricerca: modalità osservazione (camera fissa)
			pendingFollowTransition = false;

			trackingName.textContent = obj.name;
			trackingIndicator.classList.add('visible');
			updateInfoCard(obj);
			searchSuggestions.classList.remove('visible');
		}

		function stopTracking() {
			if (!trackingTarget) {
				trackingIndicator.classList.remove('visible');
				targetHud.classList.remove('visible');
				document.getElementById('info-panel').classList.remove('visible');
				document.getElementById('ai-panel').classList.remove('visible');
				return;
			}

			trackingTarget = null;
			trackingMode = 'observe';
			pendingFollowTransition = false;
			isAnimatingCamera = false;
			trackingIndicator.classList.remove('visible');
			targetHud.classList.remove('visible');
			document.getElementById('info-panel').classList.remove('visible');
			document.getElementById('ai-panel').classList.remove('visible');
			if (narrationSignal) narrationSignal.abort();
			TTS.stop();

			// Avvia animazione overview separata
			window._overviewAnim = {
				startPos: camera.position.clone(),
				startTarget: controls.target.clone(),
				endPos: new THREE.Vector3(0, 18, 22),
				endTarget: new THREE.Vector3(0, 0, 0),
				startTime: performance.now(),
				duration: 2000
			};
			controls.enabled = false;
			controls.minDistance = 0.005;
			controls.enableZoom = true; // ripristina lo zoom normale di OrbitControls
		}

		// Easing function (smooth)
		function easeInOutCubic(t) {
			return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		}

		// Update camera tracking (called in animate loop)
		function updateCameraTracking(delta) {
			if (!trackingTarget) return;

			const targetPos = trackingTarget.getPosition();

			if (isAnimatingCamera) {
				controls.enabled = false;
				const elapsed = performance.now() - cameraAnimStart;
				const progress = Math.min(elapsed / cameraAnimDuration, 1);
				const eased = easeInOutCubic(progress);

				const destination = targetPos.clone().add(cameraEndOffset);
				camera.position.lerpVectors(cameraStartPos, destination, eased);
				controls.target.copy(targetPos);

				if (progress >= 1) {
					isAnimatingCamera = false;
					controls.enabled = true;
					controls.target.copy(targetPos);
					controls.update();
					
					// Fissa la posizione base della camera per l'observe dinamico
					observeAnchorPos.copy(camera.position).sub(targetPos);
					observeStartTime = performance.now() / 1000;
					
					// Scomponi l'offset nel frame orbitale ISTANTANEO del pianeta
					const rad0 = targetPos.clone().normalize();
					const tan0 = new THREE.Vector3(-rad0.z, 0, rad0.x).normalize();
					const up0 = new THREE.Vector3(0, 1, 0);
					observeOffRadial  = observeAnchorPos.dot(rad0);
					observeOffTangent = observeAnchorPos.dot(tan0);
					observeOffUp      = observeAnchorPos.dot(up0);
					
					observeFixedPos.copy(camera.position);   // camera ferma qui durante il transito
					observePhase = 'TRANSIT';
					
					

					// Se stavamo transitando verso follow, attiva la modalità follow
					if (pendingFollowTransition) {
						pendingFollowTransition = false;
						trackingMode = 'follow';
						trackingName.textContent = trackingTarget.name;

						let objectRadius = sunRadiusScene;
						const planetObj = planets.find(p => p.name === trackingTarget.name);
						const dwarfObj = dwarfPlanets.find(p => p.name === trackingTarget.name);
						const satObj = satellites.find(s => s.name === trackingTarget.name);
						if (planetObj) objectRadius = planetObj.realRadius;
						else if (dwarfObj) objectRadius = dwarfObj.realRadius;
						else if (satObj) objectRadius = satObj.realRadius;

						controls.minDistance = Math.max(objectRadius * 1.5, 0.0002);
					}
				}
			
			} else if (trackingMode === 'observe') {
				  const speed = isPlaying ? Math.max(1, speedMultiplier) : 1;
				  const t = 1 - Math.pow(1 - OBSERVE_SMOOTH, delta * 60 * speed);
				  const s = THREE.MathUtils.clamp(t, 0, 1);

				  const distToPlanet = camera.position.distanceTo(targetPos);

				  if (observePhase === 'TRANSIT') {
					// FASE 1: camera FERMA nel punto di ripresa; segue solo lo SGUARDO.
					// Il pianeta attraversa l'inquadratura (da un lato all'altro).
					const fixed = observeFixedPos.clone().multiplyScalar(observeUserZoom > 0 ? 1 : 1);
					camera.position.lerp(observeFixedPos, s * 0.5); // resta ancorata, arrivo morbido
					controls.target.lerp(targetPos, s);             // gira solo verso il pianeta

					// Quando il pianeta si è allontanato oltre soglia -> passa a CHASE
					if (distToPlanet > chaseDist) {
					  observePhase = 'CHASE';
					}
				  } else { // CHASE
					// FASE 2: insegue da lontano mantenendo distanza chaseDist,
					// leggermente dall'alto per tenere in campo Sole e orbite.
					const dir = camera.position.clone().sub(targetPos).normalize();
					const desiredPos = targetPos.clone().add(dir.multiplyScalar(chaseDist * observeUserZoom));
					desiredPos.y += chaseDist * 0.25;
					camera.position.lerp(desiredPos, s);
					controls.target.lerp(targetPos, s);
				  }

				
				
			} else if (trackingMode === 'follow') {
				// Camera si muove con l'oggetto
				let objectRadius = sunRadiusScene;
				const planetObj = planets.find(p => p.name === trackingTarget.name);
				const dwarfObj = dwarfPlanets.find(p => p.name === trackingTarget.name);
				const satObj = satellites.find(s => s.name === trackingTarget.name);
				if (planetObj) objectRadius = planetObj.realRadius;
				else if (dwarfObj) objectRadius = dwarfObj.realRadius;
				else if (satObj) objectRadius = satObj.realRadius;

				const currentOffset = camera.position.clone().sub(controls.target);
				const currentDist = currentOffset.length();

				// Distanza ideale: oggetto ben visibile
				const idealDist = objectRadius * 4;

				// Se troppo lontana, avvicina gradualmente
				if (currentDist > idealDist) {
					const newDist = currentDist + (idealDist - currentDist) * 0.03;
					currentOffset.normalize().multiplyScalar(newDist);
				}

				controls.target.copy(targetPos);
				camera.position.copy(targetPos).add(currentOffset);

				controls.minDistance = Math.max(objectRadius * 1.5, 0.0002);
			}	
		}

		// Event listeners
		searchInput.addEventListener('input', (e) => {
			const results = getSearchResults(e.target.value);
			showSuggestions(results);
		});

		searchInput.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				const query = searchInput.value;
				const results = getSearchResults(query);

				// 1) Match testuale diretto → comportamento immediato invariato
				if (results.length > 0) {
					searchInput.value = results[0].name;
					searchSuggestions.classList.remove('visible');
					navigateToObject(results[0].name);
					return;
				}

				// 2) Nessun match letterale: se l'AI è attiva, decidi se è domanda o navigazione
				if (AI.enabled) {
				  searchSuggestions.classList.remove('visible');
				  showStatus('🤖 interpreto…', 8000);
				  try {
					const intent = await classifyQuery(query);

					if (intent === 'question') {
					  searchStatus.classList.remove('visible');
					  await answerAstronomyQuestion(query);   // apre il pannello Guida AI con la risposta
					} else {
					  const resolved = await resolveQuerySemantic(query);
					  if (resolved) {
						searchInput.value = resolved;
						searchStatus.classList.remove('visible');
						navigateToObject(resolved);
					  } else {
						showStatus('⚠ NESSUN RISULTATO');
					  }
					}
				  } catch (err) {
					console.warn('[AI] interpretazione query fallita:', err);
					showStatus('⚠ NESSUN RISULTATO');
				  }
				} else {
				  showStatus('⚠ NESSUN RISULTATO');
				}
			}
			if (e.key === 'Escape') {
				searchSuggestions.classList.remove('visible');
				searchInput.blur();
			}
		});
		stopTrackingBtn.addEventListener('click', stopTracking);
		
		document.querySelectorAll('.legend-item').forEach(item => {
			item.addEventListener('click', () => {
				const planetName = item.textContent.trim();
				const obj = searchableObjects.find(o => o.name === planetName);
				if (obj) {
					searchInput.value = planetName;
					navigateToObject(planetName);
				}
			});
		});


		// Click outside to close suggestions
		document.addEventListener('click', (e) => {
			if (!e.target.closest('#search-container')) {
				searchSuggestions.classList.remove('visible');
			}
		});
		
		document.addEventListener('keydown', (e) => {
			if (e.key === '/' && document.activeElement !== searchInput) {
				e.preventDefault();
				searchInput.focus();
			}
		});
		
		// === TARGET HUD SYSTEM ===
		const targetHud = document.getElementById('target-hud');
		const hudLabel = document.getElementById('hud-label');
	
		function updateTargetHUD() {
			if (!trackingTarget) {
				targetHud.classList.remove('visible');
				return;
			}

			const targetPos = trackingTarget.getPosition();
			camera.updateMatrixWorld();

			const projected = targetPos.clone().project(camera);

			if (projected.z > 1) {
				targetHud.classList.remove('visible');
				return;
			}

			const screenX = (projected.x * 0.5 + 0.5) * window.innerWidth;
			const screenY = (-projected.y * 0.5 + 0.5) * window.innerHeight;

			// Dimensione ring fissa (o basata su distanza)
			const dist = camera.position.distanceTo(targetPos);
			let objectRadius = sunRadiusScene;
			const planetObj = planets.find(p => p.name === trackingTarget.name);
			const dwarfObj = dwarfPlanets.find(p => p.name === trackingTarget.name);
			const satObj = satellites.find(s => s.name === trackingTarget.name);
			if (planetObj) objectRadius = planetObj.realRadius;
			else if (dwarfObj) objectRadius = dwarfObj.realRadius;
			else if (satObj) objectRadius = satObj.realRadius;

			const dynamicScale = getDynamicScale(objectRadius, dist, MIN_PIXEL_SIZE);
			const apparentRadius = objectRadius * dynamicScale;
			const angularSize = apparentRadius / dist;
			const ringSize = Math.max(50, Math.min(150, angularSize * window.innerHeight * 3));

			// Posiziona il contenitore centrato sull'oggetto
			targetHud.style.left = screenX + 'px';
			targetHud.style.top = screenY + 'px';

			const ring = targetHud.querySelector('.hud-ring');
			ring.style.width = ringSize + 'px';
			ring.style.height = ringSize + 'px';

			document.getElementById('hud-label').textContent = trackingTarget.name;

			targetHud.classList.add('visible');
		}
		
		// === CLICK TO FOLLOW (RAYCASTER) ===
		const raycaster = new THREE.Raycaster();
		const mouse = new THREE.Vector2();

		renderer.domElement.addEventListener('click', (event) => {
			// Ignora se stiamo già animando
			if (isAnimatingCamera) return;

			mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
			mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

			raycaster.setFromCamera(mouse, camera);

			// Raccogli tutti i mesh cliccabili
			const clickableMeshes = [sun];
			planets.forEach(p => clickableMeshes.push(p.mesh));
			dwarfPlanets.forEach(p => clickableMeshes.push(p.mesh));
			satellites.forEach(s => clickableMeshes.push(s.mesh));

			const intersects = raycaster.intersectObjects(clickableMeshes, false);

			if (intersects.length > 0) {
				// Filtra: accetta solo se il punto di intersezione è vicino al centro visivo
				// (evita click accidentali su oggetti con scala enorme)
				const hit = intersects[0];
				const hitScreenPos = hit.object.position.clone().project(camera);
				const clickScreenX = (event.clientX / window.innerWidth) * 2 - 1;
				const clickScreenY = -(event.clientY / window.innerHeight) * 2 + 1;
				const screenDist = Math.sqrt(
					Math.pow(hitScreenPos.x - clickScreenX, 2) +
					Math.pow(hitScreenPos.y - clickScreenY, 2)
				);
				// Se il centro dell'oggetto è troppo lontano dal click sullo schermo, ignora
				if (screenDist > 0.15) return;

				const clickedMesh = hit.object;

				// Trova quale oggetto è stato cliccato
				let clickedName = null;
				let clickedType = null;
				if (clickedMesh === sun) {
					clickedName = 'Sole';
					clickedType = 'star';
				} else {
					const p = planets.find(pl => pl.mesh === clickedMesh);
					if (p) { clickedName = p.name; clickedType = 'planet'; }
					const d = dwarfPlanets.find(dp => dp.mesh === clickedMesh);
					if (d) { clickedName = d.name; clickedType = 'dwarf'; }
					const s = satellites.find(sa => sa.mesh === clickedMesh);
					if (s) { clickedName = s.name; clickedType = 'satellite'; }
				}

				if (clickedName) {
					const obj = searchableObjects.find(o => o.name === clickedName);
					if (!obj) return;

					// Calcola offset di destinazione (stessa logica di navigateToObject)
					const targetPos = obj.getPosition();
					let offsetDist = 0.01;

					if (clickedType === 'star') {
						offsetDist = sunRadiusScene * 5;
					} else if (clickedType === 'planet') {
						const pObj = planets.find(p => p.name === clickedName);
						if (pObj) {
							const fovRad = THREE.MathUtils.degToRad(camera.fov);
							const desiredAngularSize = fovRad * 0.45;
							offsetDist = pObj.realRadius / Math.tan(desiredAngularSize / 2);
							offsetDist = Math.max(offsetDist, pObj.realRadius * 3);
						}
					} else if (clickedType === 'dwarf') {
						const dObj = dwarfPlanets.find(p => p.name === clickedName);
						if (dObj) {
							const fovRad = THREE.MathUtils.degToRad(camera.fov);
							const desiredAngularSize = fovRad * 0.45;
							offsetDist = dObj.realRadius / Math.tan(desiredAngularSize / 2);
							offsetDist = Math.max(offsetDist, dObj.realRadius * 3);
						}
					} else if (clickedType === 'satellite') {
						const satObj = satellites.find(s => s.name === clickedName);
						if (satObj) {
							const fovRad = THREE.MathUtils.degToRad(camera.fov);
							const desiredAngularSize = fovRad * 0.45;
							offsetDist = satObj.realRadius / Math.tan(desiredAngularSize / 2);
							offsetDist = Math.max(offsetDist, satObj.realRadius * 3);
						}
					}

					offsetDist = Math.max(offsetDist, 0.00003);

					// Direzione camera: dal sole verso l'oggetto + leggero offset alto
					const sunPos = new THREE.Vector3(0, 0, 0);
					if (clickedType === 'star') {
						cameraEndOffset = new THREE.Vector3(
							offsetDist * 0.3, offsetDist * 0.4, offsetDist * 0.85
						);
					} else {
						const radialDir = targetPos.clone().normalize();
						const tangentDir = new THREE.Vector3(-radialDir.z, 0, radialDir.x).normalize();
						const upDir = new THREE.Vector3(0, 1, 0);
						const cameraDir = tangentDir.clone().multiplyScalar(0.35)
							.add(upDir.clone().multiplyScalar(0.5))
							.add(radialDir.clone().multiplyScalar(0.25))
							.normalize();
						cameraEndOffset = cameraDir.multiplyScalar(offsetDist);
					}

					// Imposta tracking e avvia animazione verso follow
					trackingTarget = obj;
					userInterrupted = false;
					pendingFollowTransition = true;
					cameraStartPos.copy(camera.position);
					cameraAnimStart = performance.now();
					isAnimatingCamera = true;

					controls.minDistance = Math.max(offsetDist * 0.1, 0.0001);

					trackingName.textContent = clickedName;
					trackingIndicator.classList.add('visible');
					updateInfoCard(obj);
				}
			}
		});
		
		renderer.domElement.addEventListener('wheel', (e) => {
			if (trackingTarget && trackingMode === 'observe' && !isAnimatingCamera) {
				e.preventDefault();
				const factor = e.deltaY > 0 ? 1.08 : 0.92; // out : in
				observeUserZoom = THREE.MathUtils.clamp(observeUserZoom * factor, 0.15, 8.0);
			}
		}, { passive: false });
		

        function animate() {
            requestAnimationFrame(animate);

            const delta = clock.getDelta();

            if (isPlaying) {
                // 1 real second = 1 simulated day * speedMultiplier
                const dayStep = delta * speedMultiplier;
                simulatedDays += dayStep;
				const totalDays = daysFromJ2000 + simulatedDays;

                // Update planet positions
                planets.forEach(planet => {
                    const p = keplerPosition(planet, totalDays);
					planet.mesh.position.set(p.x, p.y, p.z);
                });
				
				// Update dwarf planet positions
				dwarfPlanets.forEach(planet => {
					const p = keplerPosition(planet, totalDays);
					planet.mesh.position.set(p.x, p.y, p.z);
				});
				
				// Update satellite positions
				satellites.forEach(sat => {
					const angle = sat.phase + (simulatedDays / sat.period) * Math.PI * 2;

					const x = sat.a * Math.cos(angle) - sat.c;
					const z = sat.b * Math.sin(angle);

					// Position relative to parent, with inclination
					const cosI = Math.cos(sat.inclination);
					const sinI = Math.sin(sat.inclination);

					const parentPos = sat.parentMesh.position;
					sat.mesh.position.x = parentPos.x + x;
					sat.mesh.position.y = parentPos.y + (-z * sinI);
					sat.mesh.position.z = parentPos.z + (z * cosI);

					// Update orbit group position to follow parent
					sat.orbitGroup.position.copy(parentPos);
				});
				
				
				
            }

            // Sun subtle rotation
            sun.rotation.y += delta * 0.1;
			
			// Rotazione lenta delle fasce di asteroidi
            if (isPlaying) {
                mainBelt.rotation.y += delta * 0.002 * speedMultiplier;
                kuiperBelt.rotation.y += delta * 0.0005 * speedMultiplier;
            }

            // Update info panel
            const dist = camera.position.length();
            const distUA = (dist / AU_SCALE).toFixed(2);
			
			
			// Aggiorna date display
			const dateMain = document.getElementById('sim-date');
			const dateSub = document.getElementById('sim-date-sub');
			if (dateMain && dateSub) {
				const baseDate = SIM_START_DATE;
				const simDate = new Date(baseDate.getTime() + simulatedDays * 86400000);
				const options = { day: 'numeric', month: 'long', year: 'numeric' };
				dateMain.textContent = simDate.toLocaleDateString('it-IT', options);
				const dayOfYear = Math.floor((simDate - new Date(simDate.getFullYear(), 0, 0)) / 86400000);
				dateSub.textContent = `Giorno ${dayOfYear} · ${speedMultiplier}x`;
			}
			// Aggiorna timeline fill (ciclo annuale)
			const yearProgress = (simulatedDays % 365.25) / 365.25;
			document.getElementById('timeline-fill').style.width = (yearProgress * 100) + '%';
            
			
			// Animazione ritorno a overview
			if (window._overviewAnim) {
				const anim = window._overviewAnim;
				const elapsed = performance.now() - anim.startTime;
				const progress = Math.min(elapsed / anim.duration, 1);
				const eased = easeInOutCubic(progress);

				camera.position.lerpVectors(anim.startPos, anim.endPos, eased);
				controls.target.lerpVectors(anim.startTarget, anim.endTarget, eased);

				if (progress >= 1) {
					camera.position.copy(anim.endPos);
					controls.target.copy(anim.endTarget);
					controls.enabled = true;
					controls.update();
					window._overviewAnim = null;
				}
			}
			
			
			
			
			// Camera tracking update
            updateCameraTracking(delta);	
			controls.update();
			updateTargetHUD();
			
			
			// === LOD TEXTURE SWITCHING ===
			// Sun LOD
			const sunDist = camera.position.distanceTo(sun.position);
			if (sunDist < LOD_THRESHOLD && sun.userData.currentLOD === 'low') {
				sun.material.map = textures.sun.high;
				sun.material.needsUpdate = true;
				sun.userData.currentLOD = 'high';
			} else if (sunDist >= LOD_THRESHOLD && sun.userData.currentLOD === 'high') {
				sun.material.map = textures.sun.low;
				sun.material.needsUpdate = true;
				sun.userData.currentLOD = 'low';
			}

			// Planets LOD
			planets.forEach(planet => {
				const planetDist = camera.position.distanceTo(planet.mesh.position);
				const texData = textures[planet.texKey];
				if (!texData) return;

				if (planetDist < LOD_THRESHOLD && planet.mesh.userData.currentLOD === 'low' && texData.high) {
					planet.mesh.material.map = texData.high;
					planet.mesh.material.needsUpdate = true;
					planet.mesh.userData.currentLOD = 'high';
				} else if (planetDist >= LOD_THRESHOLD && planet.mesh.userData.currentLOD === 'high') {
					planet.mesh.material.map = texData.low;
					planet.mesh.material.needsUpdate = true;
					planet.mesh.userData.currentLOD = 'low';
				}

				// Saturn ring LOD
				if (planet.name === 'Saturno') {
					const ring = planet.mesh.children[0];
					if (ring && ring.userData) {
						if (planetDist < LOD_THRESHOLD && ring.userData.currentLOD === 'low') {
							ring.material.map = textures.saturnRing.high;
							ring.material.needsUpdate = true;
							ring.userData.currentLOD = 'high';
						} else if (planetDist >= LOD_THRESHOLD && ring.userData.currentLOD === 'high') {
							ring.material.map = textures.saturnRing.low;
							ring.material.needsUpdate = true;
							ring.userData.currentLOD = 'low';
						}
					}
				}
			});
			
			// Dwarf Planets LOD
			dwarfPlanets.forEach(planet => {
				const planetDist = camera.position.distanceTo(planet.mesh.position);
				const texData = textures[planet.texKey];
				if (!texData) return;

				if (planetDist < LOD_THRESHOLD && planet.mesh.userData.currentLOD === 'low' && texData.high) {
					planet.mesh.material.map = texData.high;
					planet.mesh.material.needsUpdate = true;
					planet.mesh.userData.currentLOD = 'high';
				} else if (planetDist >= LOD_THRESHOLD && planet.mesh.userData.currentLOD === 'high') {
					planet.mesh.material.map = texData.low;
					planet.mesh.material.needsUpdate = true;
					planet.mesh.userData.currentLOD = 'low';
				}
			});
			
			// Satellites LOD (Luna only has high-res texture)
			satellites.forEach(sat => {
				if (sat.isLuna) {
					const satDist = camera.position.distanceTo(sat.mesh.position);
					if (satDist < LOD_THRESHOLD && sat.mesh.userData.currentLOD === 'low') {
						sat.mesh.material.map = textures.moon.high;
						sat.mesh.material.needsUpdate = true;
						sat.mesh.userData.currentLOD = 'high';
					} else if (satDist >= LOD_THRESHOLD && sat.mesh.userData.currentLOD === 'high') {
						sat.mesh.material.map = textures.moon.low;
						sat.mesh.material.needsUpdate = true;
						sat.mesh.userData.currentLOD = 'low';
					}
				}
			});
			
			// === ADAPTIVE NEAR PLANE ===
			// Se stiamo tracciando un oggetto, basa il near plane sulla distanza da esso
			let referenceDistance = camera.position.length(); // distanza dall'origine (default)

			if (trackingTarget) {
				const targetPos = trackingTarget.getPosition();
				referenceDistance = camera.position.distanceTo(targetPos);
			}

			// Near plane molto aggressivo per permettere zoom estremo
			const newNear = Math.max(0.0001, referenceDistance * 0.001);
			const newFar = Math.max(5000, referenceDistance * 50 + 2000);

			if (Math.abs(camera.near - newNear) > newNear * 0.2) {
				camera.near = newNear;
				camera.far = newFar;
				camera.updateProjectionMatrix();
			}
			
			// === DYNAMIC SCALING ===
			// Sun
			const sunDistToCam = camera.position.distanceTo(sun.position);
			const sunScale = getDynamicScale(sunRadiusScene, sunDistToCam, SUN_MIN_PIXEL_SIZE);
			sun.scale.setScalar(sunScale);
			const glowWorldSize = sunRadiusScene * 6;
			const glowLocalSize = glowWorldSize / sunScale;
			const maxGlowLocal = sunRadiusScene * 30; // cap per evitare glow enorme
			glowSprite.scale.set(
				Math.min(glowLocalSize, maxGlowLocal),
				Math.min(glowLocalSize, maxGlowLocal),
				1
			);

			// Planets
			planets.forEach(planet => {
				const distToCam = camera.position.distanceTo(planet.mesh.position);
				const scale = getDynamicScale(planet.realRadius, distToCam, MIN_PIXEL_SIZE);
				planet.mesh.scale.setScalar(scale);
			});

			// Dwarf Planets
			dwarfPlanets.forEach(planet => {
				const distToCam = camera.position.distanceTo(planet.mesh.position);
				const scale = getDynamicScale(planet.realRadius, distToCam, MIN_PIXEL_SIZE);
				planet.mesh.scale.setScalar(scale);
			});

			// Satellites
			satellites.forEach(sat => {
				const distToCam = camera.position.distanceTo(sat.mesh.position);
				const scale = getDynamicScale(sat.realRadius, distToCam, SAT_MIN_PIXEL_SIZE);
				sat.mesh.scale.setScalar(scale);
			});

			// Asteroid belts
			const camDistAU = camera.position.length() / AU_SCALE;
			const asteroidScale = THREE.MathUtils.clamp(
				THREE.MathUtils.mapLinear(camDistAU, 0.5, 60, ASTEROID_MIN_SCALE, ASTEROID_MAX_SCALE),
				ASTEROID_MIN_SCALE,
				ASTEROID_MAX_SCALE
			);
			mainBelt.children.forEach(child => { child.scale.setScalar(asteroidScale); });
			kuiperBelt.children.forEach(child => { child.scale.setScalar(asteroidScale * 0.8); });
			
			
            composer.render();
        }


		// === AUDIO TOGGLE ===
		const audioBtn = document.getElementById('audio-btn');
		const audioIcon = document.getElementById('audio-icon');

		function renderAudioIcon() {
		  if (TTS.enabled) {
			// icona con onde sonore (audio ON)
			audioIcon.innerHTML =
			  '<path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor"/>' +
			  '<path d="M16 8c1.5 1.5 1.5 6.5 0 8" fill="none" stroke="currentColor" stroke-width="2"/>' +
			  '<path d="M19 5c3 3 3 11 0 14" fill="none" stroke="currentColor" stroke-width="2"/>';
		  } else {
			// icona muto (audio OFF)
			audioIcon.innerHTML =
			  '<path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor"/>' +
			  '<line x1="17" y1="8" x2="22" y2="13" stroke="currentColor" stroke-width="2"/>' +
			  '<line x1="22" y1="8" x2="17" y2="13" stroke="currentColor" stroke-width="2"/>';
		  }
		}

		audioBtn.addEventListener('click', () => {
		  if (!TTS.supported) return;
		  TTS.enabled = !TTS.enabled;
		  audioBtn.classList.toggle('active', TTS.enabled);
		  renderAudioIcon();

		  if (TTS.enabled) {
			// se c'è già del testo nella card AI, leggilo subito
			const bodyEl = document.getElementById('ai-narration');
			if (bodyEl && bodyEl.textContent && bodyEl.textContent !== '—') {
			  TTS.speak(bodyEl.textContent);
			}
		  } else {
			TTS.stop(); // audio off → interrompe subito
		  }
		});
		renderAudioIcon();
		
		// === IDLE DETECTION ===
		let idleTimer;
		function resetIdle() {
			document.body.classList.remove('idle');
			clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				document.body.classList.add('idle');
			}, 6000);
		}
		document.addEventListener('mousemove', resetIdle);
		document.addEventListener('click', resetIdle);
		document.addEventListener('keydown', resetIdle);
		
		resetIdle();
		
		
		
		// ============================================================
// MODULO GAME — Escape Room spaziale (IIFE con stato privato)
// ============================================================
const Game = (() => {
  const STORAGE_KEY = 'escapeGame:run';
  const KEY_SEED = 'FastwebAIWork-EscapeGame';

  // --- stato PRIVATO (non accessibile da window/Game.) ---
  let _run = null;      // struttura completa con dati sensibili
  let _mode = 'sim';    // 'sim' | 'game'
  let _busy = false;
  let _arriveHook = null; // callback quando la camera arriva alla tappa

  // ---- offuscamento Base64 + XOR (deterrente per localStorage) ----
  function _xor(str, key) {
    let out = '';
    for (let i = 0; i < str.length; i++)
      out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    return out;
  }
  function _obf(obj, id) {
    return btoa(unescape(encodeURIComponent(_xor(JSON.stringify(obj), KEY_SEED + id))));
  }
  function _deobf(b64, id) {
    try { return JSON.parse(_xor(decodeURIComponent(escape(atob(b64))), KEY_SEED + id)); }
    catch (_) { return null; }
  }
  function _persist() {
    if (!_run) return;
    // id in chiaro come prefisso (serve per rileggere), payload offuscato
    try { localStorage.setItem(STORAGE_KEY, _run.id + '|' + _obf(_run, _run.id)); } catch (_) {}
  }
  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const sep = raw.indexOf('|');
      if (sep === -1) return null;
      const id = raw.slice(0, sep);
      return _deobf(raw.slice(sep + 1), id);
    } catch (_) { return null; }
  }
  function _clear() { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }

  // ---- riferimenti UI ----
  const el = {};
  function _cacheEls() {
    el.toggle     = document.getElementById('game-toggle');
    el.panel      = document.getElementById('game-panel');
    el.title      = document.getElementById('game-title');
    el.status     = document.getElementById('game-status');
    el.body       = document.getElementById('game-body');
    el.components = document.getElementById('game-components');
    el.inputRow   = document.getElementById('game-input-row');
    el.answer     = document.getElementById('game-answer');
    el.submit     = document.getElementById('game-submit');
  }
  function setStatus(t) { el.status.textContent = t || ''; }
  function setBody(t) { el.body.textContent = t; }
  function showInput(show) { el.inputRow.style.display = show ? 'flex' : 'none'; }
  function renderComponents() {
    if (!_run) { el.components.innerHTML = ''; return; }
    el.components.innerHTML = _run.tappe
      .filter(t => t.risolta && t.componenteNome)
      .map(t => `<span class="game-chip">🔧 ${t.componenteNome}</span>`)
      .join('');
  }

  // ---- catalogo nomi reali (vincolo per l'AI) ----
  function catalogNames() { return searchableObjects.map(o => o.name); }
  const _existsInCatalog = n =>
    searchableObjects.some(o => o.name.toLowerCase() === String(n).toLowerCase());
  const _canonName = n => {
    const m = searchableObjects.find(o => o.name.toLowerCase() === String(n).toLowerCase());
    return m ? m.name : null;
  };

  // ============ CHIAMATA A: struttura base ============
  async function generateRun() {
    const nTappe = 5 + Math.floor(Math.random() * 4); // 5..8 (rand JS, non AI)
    const nomi = catalogNames();
    const system =
      'Sei il generatore di un gioco escape-room spaziale. Rispondi SOLO con JSON valido, in ITALIANO. ' +
      'Inventa una fuga dalla Terra verso un corpo celeste. Ogni tappa DEVE usare un nome ESATTO ' +
      'dalla lista fornita. Accetta licenza narrativa (mete anche irraggiungibili nella realtà).';
    const prompt =
      `Corpi disponibili (usa ESATTAMENTE questi nomi): ${nomi.join(', ')}.\n` +
      `Genera una missione con ESATTAMENTE ${nTappe} tappe intermedie, tutte DIVERSE tra loro, ` +
      `più una destinazione finale (scelta dalla lista, diversa dalle tappe e diversa dalla Terra).\n` +
      `Formato JSON:\n` +
      `{"titolo":"...","catastrofe":"...","narrativaIniziale":"3-4 frasi",` +
      `"destinazione":{"oggetto":"<nome esatto>","motivo":"..."},` +
      `"tappe":[{"ordine":1,"oggetto":"<nome esatto>","tipo":"pianeta|luna|asteroide|stella|nano|deepsky"}]}`;

    const res = await AI.ask({ prompt, system, json: true, useCache: false, timeout: 120000 });

    // --- validazione rigorosa ---
    if (!res || !Array.isArray(res.tappe) || !res.destinazione) throw new Error('GEN_INVALID');
    const tappe = res.tappe
      .filter(t => t && _existsInCatalog(t.oggetto))
      .map((t, i) => ({
        ordine: i + 1,
        oggetto: _canonName(t.oggetto),
        tipo: t.tipo || 'pianeta',
        raffinata: false,
        risolta: false,
        componenteNome: null,
        tentativi: 0,
        // campi sensibili (popolati in fase B, tenuti solo qui in closure)
        _sfida: null,       // { tipo, testo, indizi[], rispostaAttesa, criterio }
        _indizeUsati: 0,
      }));
    if (tappe.length < 4) throw new Error('GEN_TOO_FEW_STAGES');

    return {
      id: 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      titolo: res.titolo || 'Fuga dalla Terra',
      catastrofe: res.catastrofe || '',
      narrativaIniziale: res.narrativaIniziale || '',
      destinazione: {
        oggetto: _canonName(res.destinazione.oggetto) || tappe[tappe.length - 1].oggetto,
        motivo: res.destinazione.motivo || '',
      },
      tappe,
      corrente: 0,      // indice della tappa attuale
      completata: false,
    };
  }

  // ============ CHIAMATA B: raffinamento singola tappa ============
  async function refineStage(idx) {
    const tappa = _run.tappe[idx];
    if (tappa.raffinata && tappa._sfida) return; // già fatto (ripresa)

    const system =
      'Genera il contenuto di UNA tappa di un gioco escape-room spaziale. Rispondi SOLO con JSON valido, ' +
      'in ITALIANO. La sfida deve essere risolvibile e avere una risposta corretta chiara. ' +
      'Puoi usare dati astronomici reali del corpo celeste indicato.';
    const prompt =
      `Contesto missione: "${_run.titolo}" — ${_run.catastrofe}.\n` +
      `Tappa ${tappa.ordine} sul corpo celeste: ${tappa.oggetto} (tipo: ${tappa.tipo}).\n` +
      `Genera JSON:\n` +
      `{"descrizioneAmbientazione":"2-3 frasi che calano il giocatore nella tappa",` +
      `"sfida":{"tipo":"domanda|indovinello|enigma_logico|enigma_matematico",` +
      `"testo":"la sfida","indizi":["indizio1","indizio2"],` +
      `"rispostaAttesa":"soluzione di riferimento","criterio":"cosa rende corretta una risposta"},` +
      `"componente":{"nome":"es. Cella a fusione","descrizione":"a cosa serve per l'astronave"}}`;

    const res = await AI.ask({ prompt, system, json: true, useCache: false, timeout: 120000 });
    if (!res || !res.sfida || !res.sfida.testo) throw new Error('REFINE_INVALID');

    tappa.descrizione = res.descrizioneAmbientazione || '';
    tappa._sfida = {
      tipo: res.sfida.tipo || 'domanda',
      testo: res.sfida.testo,
      indizi: Array.isArray(res.sfida.indizi) ? res.sfida.indizi : [],
      rispostaAttesa: res.sfida.rispostaAttesa || '',
      criterio: res.sfida.criterio || '',
    };
    tappa.componenteNome = (res.componente && res.componente.nome) || 'Componente ignoto';
    tappa.componenteDesc = (res.componente && res.componente.descrizione) || '';
    tappa.raffinata = true;
    _persist();
  }

  // ============ GIUDICE AI: valuta la risposta ============
  async function judgeAnswer(idx, userAnswer) {
    const tappa = _run.tappe[idx];
    const s = tappa._sfida;
    const preIndizio = s.indizi[tappa._indizeUsati] || null; // indizio pre-generato non ancora mostrato

    const system =
      'Sei il giudice di un gioco escape-room. Valuta se la risposta dell\'utente è corretta, ' +
      'accettando sinonimi, maiuscole diverse e piccoli errori di battitura. Rispondi SOLO con JSON ' +
      'valido, in ITALIANO. Se la risposta è errata, fornisci UN indizio utile ma non la soluzione.';
    const prompt =
      `Sfida: "${s.testo}".\n` +
      `Risposta attesa (riferimento): "${s.rispostaAttesa}".\n` +
      `Criterio di correttezza: "${s.criterio}".\n` +
      (preIndizio ? `Indizio disponibile da riusare se serve: "${preIndizio}".\n` : '') +
      `Risposta dell'utente: "${userAnswer}".\n` +
      `JSON: {"corretta":true|false,"spiegazione":"breve","indizio":"nuovo indizio o null se corretta"}`;

    const res = await AI.ask({ prompt, system, json: true, useCache: false, timeout: 90000 });
        if (!res) return { corretta: false, spiegazione: 'Nessuna risposta dal giudice.', indizio: preIndizio };

    if (res.corretta) {
      // consuma eventuale indizio preparato non serve più
      return { corretta: true, spiegazione: res.spiegazione || 'Corretto!', indizio: null };
    }
    // errata: se c'è un indizio pre-generato non ancora usato, lo consumiamo (ibrido)
    let indizio = res.indizio || null;
    if (preIndizio) { tappa._indizeUsati++; indizio = preIndizio; }
    return { corretta: false, spiegazione: res.spiegazione || 'Non è la risposta giusta.', indizio };
  }

  // ============ FLUSSO DI GIOCO ============
  async function renderCurrentStage() {
    if (_run.completata) return finishGame();
    const idx = _run.corrente;
    const tappa = _run.tappe[idx];
    el.title.textContent = `Tappa ${tappa.ordine}/${_run.tappe.length}`;
    setStatus('preparo…');
    setBody('Rotta verso ' + tappa.oggetto + '…');
    showInput(false);
    renderComponents();
    // vola verso l'oggetto reale
    navigateToObject(tappa.oggetto);
    // raffina la tappa (lazy)
    try {
      await refineStage(idx);
    } catch (e) {
      setStatus('errore'); setBody('Impossibile generare la tappa. Riprova più tardi.');
      return;
    }
    setStatus('');
    setBody(`📍 ${tappa.oggetto}\n\n${tappa.descrizione}\n\n🧩 ${tappa._sfida.testo}`);
    showInput(true);
    el.answer.value = '';
    el.answer.focus();
  }

  async function submitAnswer() {
    if (_busy || !_run || _run.completata) return;
    const txt = (el.answer.value || '').trim();
    if (!txt) return;
    _busy = true;
    el.submit.disabled = true;
    setStatus('valuto…');
    const idx = _run.corrente;
    const tappa = _run.tappe[idx];
    tappa.tentativi++;
    try {
      const verdict = await judgeAnswer(idx, txt);
      if (verdict.corretta) {
        tappa.risolta = true;
        _persist();
        renderComponents();
        setBody(`✅ ${verdict.spiegazione}\n\n🔧 Hai raccolto: ${tappa.componenteNome}\n${tappa.componenteDesc || ''}`);
        showInput(false);
        // avanza
        if (idx + 1 >= _run.tappe.length) {
          _run.completata = true; _persist();
          setTimeout(finishGame, 2200);
        } else {
          _run.corrente = idx + 1; _persist();
          setTimeout(renderCurrentStage, 2200);
        }
      } else {
        const hint = verdict.indizio ? `\n\n💡 Indizio: ${verdict.indizio}` : '';
        setBody(`❌ ${verdict.spiegazione}${hint}\n\n🧩 ${tappa._sfida.testo}`);
        el.answer.value = '';
        el.answer.focus();
      }
    } catch (e) {
      setBody('⚠ Il giudice AI non ha risposto. Riprova.');
    } finally {
      _busy = false;
      el.submit.disabled = false;
      setStatus('');
    }
  }

  function finishGame() {
    el.title.textContent = 'Missione compiuta';
    setStatus('🏁');
    const d = _run.destinazione;
    setBody(`🚀 Con tutti i componenti raccolti, l'astronave raggiunge ${d.oggetto}!\n\n${d.motivo}\n\nL'umanità è salva. Fine della fuga.`);
    showInput(false);
    renderComponents();
    navigateToObject(d.oggetto);
    _clear(); // partita conclusa: pulizia stato salvato
  }

  // ============ AVVIO / RIPRESA / TOGGLE ============
  async function startNewRun() {
    setStatus('genero missione…');
    setBody('Una catastrofe minaccia la Terra… preparo la fuga.');
    showInput(false);
    try {
      _run = await generateRun();
      _persist();
      setBody(`🌍 ${_run.titolo}\n\n${_run.catastrofe}\n\n${_run.narrativaIniziale}`);
      setTimeout(renderCurrentStage, 2600);
    } catch (e) {
      setStatus('errore');
      setBody('Generazione non riuscita. Verifica che Ollama sia attivo e riprova.');
    }
  }

  async function enterGame() {
    if (!AI.enabled) { setBody('⚠ AI non disponibile: avvia Ollama per giocare.'); el.panel.classList.add('visible'); return; }
    _mode = 'game';
    el.toggle.classList.add('game-active');
    el.panel.classList.add('visible');
    const saved = _load();
    if (saved && !saved.completata) {
      _run = saved;
      // i campi _sfida sono già dentro _run (offuscati in storage, in chiaro in RAM)
      renderCurrentStage();
    } else {
      await startNewRun();
    }
  }

  function exitGame() {
    _mode = 'sim';
    el.toggle.classList.remove('game-active');
    el.panel.classList.remove('visible');
    if (typeof stopTracking === 'function') stopTracking();
  }

  function toggleMode() { _mode === 'game' ? exitGame() : enterGame(); }

  function init() {
    _cacheEls();
    if (!el.toggle) return;
    el.toggle.addEventListener('click', toggleMode);
    el.submit.addEventListener('click', submitAnswer);
    el.answer.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAnswer(); });
  }

  // API pubblica MINIMALE (nessun dato sensibile esposto)
  return { init, toggleMode, isGameMode: () => _mode === 'game' };
})();

Game.init();
		
		
		
		
		
		
		AI.init();
		animate();
		