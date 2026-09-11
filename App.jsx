import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import "./App.css";

/* =========================================================
   EARTH TEXTURES
   ========================================================= */

const EARTH_DAY =
  "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg";

const EARTH_NORMAL =
  "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg";

const EARTH_SPECULAR =
  "https://threejs.org/examples/textures/planets/earth_specular_2048.jpg";

const EARTH_CLOUDS =
  "https://threejs.org/examples/textures/planets/earth_clouds_1024.png";

const EARTH_LIGHTS =
  "https://threejs.org/examples/textures/planets/earth_lights_2048.png";

/* =========================================================
   ATMOSPHERE GLOW
   ========================================================= */

function AtmosphereGlow() {
  return (
    <mesh scale={1.055} renderOrder={2}>
      <sphereGeometry args={[2.45, 96, 96]} />
      <shaderMaterial
        side={THREE.FrontSide}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        uniforms={{
          glowColor: { value: new THREE.Color("#00dcff") },
          coefficient: { value: 0.72 },
          power: { value: 2.6 },
        }}
        vertexShader={`
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          void main() {
            vNormal = normalize(mat3(modelMatrix) * normal);
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `}
        fragmentShader={`
          uniform vec3 glowColor;
          uniform float coefficient;
          uniform float power;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          void main() {
            vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
            float rim = pow(1.0 - max(dot(vNormal, viewDirection), 0.0), power);
            float intensity = rim * coefficient;
            gl_FragColor = vec4(glowColor, intensity);
          }
        `}
      />
    </mesh>
  );
}

function Earth() {
  const earthRef = useRef();
  const cloudsRef = useRef();

  const [
    earthTexture,
    normalTexture,
    specularTexture,
    cloudTexture,
    lightsTexture,
  ] = useLoader(THREE.TextureLoader, [
    EARTH_DAY,
    EARTH_NORMAL,
    EARTH_SPECULAR,
    EARTH_CLOUDS,
    EARTH_LIGHTS,
  ]);

  useEffect(() => {
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    cloudTexture.colorSpace = THREE.SRGBColorSpace;
    lightsTexture.colorSpace = THREE.SRGBColorSpace;

    earthTexture.anisotropy = 8;
    normalTexture.anisotropy = 8;
    specularTexture.anisotropy = 8;
    cloudTexture.anisotropy = 4;
    lightsTexture.anisotropy = 4;

    earthTexture.wrapS = THREE.RepeatWrapping;
    cloudTexture.wrapS = THREE.RepeatWrapping;
  }, [
    earthTexture,
    normalTexture,
    specularTexture,
    cloudTexture,
    lightsTexture,
  ]);

  useFrame((state, delta) => {
    if (earthRef.current) {
      earthRef.current.rotation.y += delta * 0.085;
    }

    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += delta * 0.105;
    }
  });

  return (
    <group rotation={[0.05, -0.55, 0]}>
      <mesh ref={earthRef}>
        <sphereGeometry args={[2.45, 128, 128]} />
        <meshPhongMaterial
          map={earthTexture}
          normalMap={normalTexture}
          normalScale={new THREE.Vector2(0.75, 0.75)}
          specular={new THREE.Color("#082f3d")}
          shininess={5}
          bumpMap={normalTexture}
          bumpScale={0.012}
          emissive={new THREE.Color("#00141c")}
          emissiveIntensity={0.16}
        />
      </mesh>

      <mesh scale={1.006}>
        <sphereGeometry args={[2.45, 96, 96]} />
        <meshBasicMaterial
          map={lightsTexture}
          transparent
          opacity={0.30}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={cloudsRef} scale={1.018}>
        <sphereGeometry args={[2.45, 96, 96]} />
        <meshPhongMaterial
          map={cloudTexture}
          transparent
          opacity={0.28}
          depthWrite={false}
          side={THREE.FrontSide}
        />
      </mesh>

      <AtmosphereGlow />
    </group>
  );
}

function OrbitSystem() {
  const orbitGroup = useRef();

  useFrame((state, delta) => {
    if (!orbitGroup.current) return;
    const t = state.clock.getElapsedTime();
    orbitGroup.current.rotation.y += delta * 0.105;
    orbitGroup.current.rotation.x = Math.sin(t * 0.42) * 0.055;
    orbitGroup.current.rotation.z = Math.cos(t * 0.30) * 0.035;
  });

  return (
    <group ref={orbitGroup} rotation={[0.10, -0.18, 0.02]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.64, 0.008, 10, 256]} />
        <meshBasicMaterial
          color="#20e5ff"
          transparent
          opacity={0.62}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh rotation={[1.02, 0.38, 0.62]}>
        <torusGeometry args={[2.71, 0.007, 10, 256]} />
        <meshBasicMaterial
          color="#10c8e8"
          transparent
          opacity={0.40}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh rotation={[-0.58, -0.62, -0.24]}>
        <torusGeometry args={[2.78, 0.006, 10, 256]} />
        <meshBasicMaterial
          color="#0788aa"
          transparent
          opacity={0.27}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function EarthFallback() {
  return (
    <group rotation={[0.05, -0.55, 0]}>
      <mesh>
        <sphereGeometry args={[2.45, 96, 96]} />
        <meshStandardMaterial
          color="#063b4d"
          emissive="#00a9cc"
          emissiveIntensity={0.14}
          roughness={0.82}
          metalness={0.02}
        />
      </mesh>
      <mesh scale={1.045}>
        <sphereGeometry args={[2.45, 64, 64]} />
        <meshBasicMaterial
          color="#00dfff"
          transparent
          opacity={0.075}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function EarthScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 7.2], fov: 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
    >
      <ambientLight intensity={0.42} />

      <directionalLight
        position={[4, 2.5, 5]}
        intensity={1.15}
        color="#9bdcff"
      />

      <pointLight
        position={[-4, -1, 3]}
        intensity={0.75}
        color="#00bfe8"
      />

      <pointLight
        position={[2, -3, -2]}
        intensity={0.32}
        color="#005bff"
      />

      <OrbitSystem />

      <Suspense fallback={<EarthFallback />}>
        <Earth />
      </Suspense>

      <OrbitControls
        enableRotate={true}
        enableZoom={false}
        enablePan={false}
        enableDamping={true}
        dampingFactor={0.08}
        autoRotate={false}
        minPolarAngle={0.55}
        maxPolarAngle={2.60}
      />
    </Canvas>
  );
}

/* =========================================================
   MAIN APPLICATION
   ========================================================= */

const INSPECTOR_LABELS = {
  name: "Full Name", email: "Email", phone: "Phone",
  dob: "Date of Birth", address: "Address", employee_id: "Employee ID",
  division: "Division", gender: "Gender", clearance: "Clearance Level", password: "Password",
};

const INSPECTOR_SENSITIVE = new Set(["password", "email", "phone", "address", "dob", "employee_id", "clearance", "name"]);

const INSPECTOR_SELECTOR_MAP = {
  name: '#full_name, [name="full_name"]',
  employee_id: '#employee_id, [name="employee_id"]',
  dob: '#dob, input[type="date"]',
  gender: 'select#gender',
  email: '#email, input[type="email"]',
  phone: '#phone, input[type="tel"]',
  address: '#address, [name="address"]',
  division: 'select#division, [name="division"]',
  clearance: 'select#clearance_level',
  password: '#password, input[type="password"]',
};

export default function App() {
  const cursorRef = useRef(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [prevTab, setPrevTab] = useState("overview");
  const [inspectorProfile, setInspectorProfile] = useState({});
  const [inspectorFillDetails, setInspectorFillDetails] = useState([]);

  // All fields start empty — populated only from attached Word file
  const [isroFormData, setIsroFormData] = useState({
    full_name: "",
    employee_id: "",
    dob: "",
    gender: "",
    email: "",
    phone: "",
    address: "",
    division: "",
    clearance_level: "",
    password: "",
    confirm_password: "",
    terms: false,
  });

  const [formSubmitted, setFormSubmitted] = useState(false);
  const [showThankYouModal, setShowThankYouModal] = useState(false);
  const [submissionRef, setSubmissionRef] = useState("");
  const [copiedRef, setCopiedRef] = useState(false);
  const [missingFields, setMissingFields] = useState([]);
  const [showMissingPopup, setShowMissingPopup] = useState(false);
  const [wordFileLoaded, setWordFileLoaded] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  // Profile keys → form field names
  const PROFILE_TO_FORM = {
    name: "full_name",
    full_name: "full_name",
    employee_id: "employee_id",
    dob: "dob",
    gender: "gender",
    email: "email",
    phone: "phone",
    address: "address",
    division: "division",
    clearance: "clearance_level",
    clearance_level: "clearance_level",
  };

  // Fields expected from the Word document (password is never in Word file)
  const REQUIRED_WORD_FIELDS = ["full_name", "employee_id", "dob", "gender", "email", "phone", "address", "division", "clearance_level"];

  // All fields required for form submission (password must be entered manually)
  const REQUIRED_FORM_FIELDS = [
    "full_name",
    "employee_id",
    "dob",
    "gender",
    "email",
    "phone",
    "address",
    "division",
    "clearance_level",
    "password",
    "confirm_password",
  ];

  /* Load inspector profile from Chrome storage */
  const loadInspectorData = () => {
    if (typeof window !== "undefined" && window.chrome && window.chrome.storage) {
      window.chrome.storage.local.get(["pba_user_profile", "pba_fill_details"], (res) => {
        setInspectorProfile(res.pba_user_profile || {});
        setInspectorFillDetails(res.pba_fill_details || []);
      });
    }
  };

  /* Load Word file profile from Chrome storage and auto-populate form */
  const loadAndApplyWordProfile = () => {
    if (typeof window !== "undefined" && window.chrome && window.chrome.storage) {
      window.chrome.storage.local.get(["pba_user_profile", "pba_fill_details"], (res) => {
        const profile = res.pba_user_profile || {};
        setInspectorProfile(profile);
        setInspectorFillDetails(res.pba_fill_details || []);

        if (Object.keys(profile).length === 0) return;

        // Map profile keys → form state
        const newForm = {
          full_name: "",
          employee_id: "",
          dob: "",
          gender: "",
          email: "",
          phone: "",
          address: "",
          division: "",
          clearance_level: "",
          password: "",
          confirm_password: "",
          terms: false,
        };

        Object.entries(profile).forEach(([key, val]) => {
          const formKey = PROFILE_TO_FORM[key] || key;
          if (formKey in newForm && val) {
            newForm[formKey] = String(val).trim();
          }
        });

        setIsroFormData(newForm);
        setWordFileLoaded(true);

        // Find which required fields are still missing from the Word document
        const missing = REQUIRED_WORD_FIELDS.filter(f => !newForm[f] || String(newForm[f]).trim() === "");
        setMissingFields(missing);
        if (missing.length > 0) {
          setShowMissingPopup(true);
        }
      });
    }
  };

  useEffect(() => {
    loadInspectorData();
    loadAndApplyWordProfile();
  }, []);

  const openInspector = () => {
    setPrevTab(activeTab);
    loadInspectorData();
    setActiveTab("inspector");
  };
  const openDataInspector = openInspector;

  const closeInspector = () => {
    setActiveTab(prevTab);
  };

  useEffect(() => {
    const moveCursor = (e) => {
      if (!cursorRef.current) return;
      cursorRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };

    const handleDown = () => cursorRef.current?.classList.add("cursor-click");
    const handleUp = () => cursorRef.current?.classList.remove("cursor-click");

    window.addEventListener("mousemove", moveCursor);
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", moveCursor);
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setIsroFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    // Clear red error as soon as user starts typing/selecting
    setFieldErrors((prev) => {
      if (!prev[name] && !(name === "password" && prev.confirm_password === "mismatch")) return prev;
      const n = { ...prev };
      delete n[name];
      if (name === "password" && n.confirm_password === "mismatch") {
        delete n.confirm_password;
      }
      return n;
    });
  };

  const handleFormSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();

    const errors = {};
    const missing = [];

    // Check all required fields — mark each empty one red
    REQUIRED_FORM_FIELDS.forEach((f) => {
      const val = isroFormData[f];
      if (!val || String(val).trim() === "") {
        errors[f] = true;
        missing.push(f);
      }
    });

    // Check password confirmation matching
    if (isroFormData.password && isroFormData.confirm_password && isroFormData.password !== isroFormData.confirm_password) {
      errors.confirm_password = "mismatch";
      if (!missing.includes("confirm_password")) {
        missing.push("confirm_password");
      }
    }

    if (missing.length > 0) {
      // Build error map & highlight all invalid fields red
      setFieldErrors(errors);
      setMissingFields(missing);

      // Scroll to the first red field
      const firstField = document.querySelector(`[name="${missing[0]}"]`);
      if (firstField) {
        firstField.scrollIntoView({ behavior: "smooth", block: "center" });
        firstField.focus();
      }
      return; // Block submission completely
    }

    // All fields valid — clear errors and submit
    setFieldErrors({});
    const ref = `ISRO-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    setSubmissionRef(ref);
    setShowThankYouModal(true);
    setFormSubmitted(true);
  };

  const openWebDemoForm = () => {
    window.open("http://localhost:8000/demo/", "_blank");
  };

  return (
    <>
      <div className="custom-cursor" ref={cursorRef}>
        <span></span>
      </div>

      <div className="privacy-app">
        {/* Full-dashboard galaxy background */}
        <div className="galaxy-stars" aria-hidden="true">
          {Array.from({ length: 120 }, (_, i) => {
            const left = (i * 47.13 + 7) % 100;
            const top = (i * 83.71 + 13) % 100;
            const size = 0.7 + (i % 5) * 0.38;
            const opacity = 0.30 + (i % 6) * 0.10;

            return (
              <span
                key={i}
                className="star"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  opacity,
                  animationDelay: `${-(i % 11) * 0.7}s`,
                }}
              />
            );
          })}
        </div>

        {/* TOP HEADER */}
        <header className="topbar">
          <div className="brand">
            <div className="brand-logo">ISRO</div>
            <div>
              <div className="brand-name">PRIVACYVISION AI</div>
              <div className="brand-subtitle">ISRO PORTAL &bull; ON-DEVICE AGENT</div>
            </div>
          </div>

          <div className="system-status">
            <span className="status-dot"></span>
            SYSTEM ACTIVE
          </div>

          <div className="header-actions">
            <button title="Open Data Inspector" onClick={openDataInspector}>🔍</button>
            <button title="Launch Full Webform" onClick={openWebDemoForm}>🚀</button>
          </div>
        </header>

        {/* MAIN CONTENT */}
        <main className="dashboard">
          {/* LEFT SIDEBAR */}
          <aside className="sidebar">
            <div className="section-label">MISSION CONTROL</div>
            <nav>
              <div
                className={`nav-item ${activeTab === "overview" ? "active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                <span>◉</span> Overview
              </div>

              <div
                className={`nav-item ${activeTab === "documents" ? "active" : ""}`}
                onClick={() => setActiveTab("documents")}
              >
                <span>□</span> Documents (ISRO Form)
              </div>

              <div
                className={`nav-item ${activeTab === "profile" ? "active" : ""}`}
                onClick={() => setActiveTab("profile")}
              >
                <span>◎</span> Local Profile
              </div>

              <div
                className={`nav-item ${activeTab === "agent" ? "active" : ""}`}
                onClick={() => setActiveTab("agent")}
              >
                <span>⌁</span> Form Agent
              </div>

              <div
                className={`nav-item ${activeTab === "shield" ? "active" : ""}`}
                onClick={() => setActiveTab("shield")}
              >
                <span>◇</span> Privacy Shield
              </div>

              <div
                className={`nav-item ${activeTab === "inspector" ? "active" : ""}`}
                onClick={openDataInspector}
              >
                <span>🔍</span> Data Inspector
              </div>
            </nav>

            <div className="local-engine">
              <div className="engine-title">
                <span className="status-dot"></span> LOCAL ENGINE
              </div>
              <div className="engine-text">
                PRIVACY ENGINE OPERATIONAL
                <br />
                ISRO FORM COMPATIBLE
              </div>
            </div>
          </aside>

          {/* CENTER PANEL */}
          <section className="center-panel">
            {activeTab === "inspector" ? (
              /* ── INLINE DATA INSPECTOR VIEW ── */
              <div className="center-content-overlay inspector-overlay">
                {/* Inspector Header */}
                <div className="inspector-inline-header">
                  <div className="inspector-inline-title-group">
                    <div className="inspector-inline-icon">🔍</div>
                    <div>
                      <h2>Data &amp; Field Mapping Inspector</h2>
                      <p>Transparent view of Word file profile extraction and AI field mappings</p>
                    </div>
                  </div>
                  <button className="inspector-close-btn" onClick={closeInspector}>
                    ✕ Close
                  </button>
                </div>

                {/* Stats Row */}
                <div className="inspector-stats-row">
                  <div className="inspector-stat-card">
                    <span className="inspector-stat-label">EXTRACTED FIELDS</span>
                    <div className="inspector-stat-val">{Object.keys(inspectorProfile).length}</div>
                    <span className="inspector-stat-sub">Source: Word .docx document</span>
                  </div>
                  <div className="inspector-stat-card">
                    <span className="inspector-stat-label">PII SENSITIVE</span>
                    <div className="inspector-stat-val text-amber">
                      {Object.keys(inspectorProfile).filter(k => INSPECTOR_SENSITIVE.has(k)).length}
                    </div>
                    <span className="inspector-stat-sub">Protected on-device</span>
                  </div>
                  <div className="inspector-stat-card">
                    <span className="inspector-stat-label">COMPATIBILITY</span>
                    <div className="inspector-stat-val text-green">
                      {Object.keys(inspectorProfile).length > 0 ? "100%" : "—"}
                    </div>
                    <span className="inspector-stat-sub">Ready for auto-fill</span>
                  </div>
                  <div className="inspector-stat-card">
                    <span className="inspector-stat-label">SECURITY MODE</span>
                    <div className="inspector-stat-val text-blue">LOCAL</div>
                    <span className="inspector-stat-sub">Zero server leaks</span>
                  </div>
                </div>

                {/* Extracted Fields Grid */}
                <div className="inspector-section">
                  <div className="inspector-section-head">
                    <h3>📄 Extracted Word Profile Data</h3>
                    <span className="inspector-badge cyan">ON-DEVICE PARSED</span>
                  </div>
                  {Object.keys(inspectorProfile).length === 0 ? (
                    <div className="inspector-empty">
                      <div className="inspector-empty-icon">📂</div>
                      <p>No profile data loaded. Upload a Word document (.docx) in the extension popup first.</p>
                    </div>
                  ) : (
                    <div className="inspector-fields-grid">
                      {Object.entries(inspectorProfile).map(([k, v]) => {
                        const label = INSPECTOR_LABELS[k] || k;
                        const isSensitive = INSPECTOR_SENSITIVE.has(k);
                        const displayVal = isSensitive ? "•••••••• [PROTECTED]" : v;
                        return (
                          <div key={k} className="inspector-field-card">
                            <div className="inspector-field-top">
                              <span className="inspector-field-name">{label}</span>
                              <span className="inspector-field-key">{k}</span>
                            </div>
                            <div className="inspector-field-value">{displayVal}</div>
                            <div className="inspector-field-footer">
                              <span className={`inspector-pii-badge ${isSensitive ? "sensitive" : "standard"}`}>
                                {isSensitive ? "PROTECTED" : "STANDARD"}
                              </span>
                              <span>Word Doc Extracted</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Field Mapping Table */}
                <div className="inspector-section">
                  <div className="inspector-section-head">
                    <h3>🤖 AI Form Field Execution Map</h3>
                    <span className="inspector-badge green">LIVE MAPPING</span>
                  </div>
                  <div className="inspector-table-wrap">
                    <table className="inspector-table">
                      <thead>
                        <tr>
                          <th>Profile Key</th>
                          <th>Field Label</th>
                          <th>HTML Selector</th>
                          <th>Value</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspectorFillDetails.length > 0 ? (
                          inspectorFillDetails.map((item, i) => {
                            const label = INSPECTOR_LABELS[item.key] || item.key;
                            const isSensitive = INSPECTOR_SENSITIVE.has(item.key);
                            const displayVal = isSensitive ? "•••••••• [PROTECTED]" : item.value;
                            return (
                              <tr key={i}>
                                <td><strong>{item.key}</strong></td>
                                <td>{label}</td>
                                <td><code className="inspector-code">{item.selector}</code></td>
                                <td><strong>{displayVal}</strong></td>
                                <td><span className="inspector-status-ok">{item.status}</span></td>
                              </tr>
                            );
                          })
                        ) : Object.entries(inspectorProfile).map(([k, v]) => {
                          const label = INSPECTOR_LABELS[k] || k;
                          const selector = INSPECTOR_SELECTOR_MAP[k] || `[name="${k}"]`;
                          const isSensitive = INSPECTOR_SENSITIVE.has(k);
                          const displayVal = isSensitive ? "•••••••• [PROTECTED]" : v;
                          return (
                            <tr key={k}>
                              <td><strong>{k}</strong></td>
                              <td>{label}</td>
                              <td><code className="inspector-code">{selector}</code></td>
                              <td><strong>{displayVal}</strong></td>
                              <td><span className="inspector-status-ok">READY</span></td>
                            </tr>
                          );
                        })}
                        {Object.keys(inspectorProfile).length === 0 && inspectorFillDetails.length === 0 && (
                          <tr><td colSpan="5" className="inspector-td-empty">Load a profile to see field mappings.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Raw JSON */}
                <div className="inspector-section">
                  <div className="inspector-section-head">
                    <h3>{ } Raw Extracted Profile (JSON)</h3>
                    <span className="inspector-badge purple">STRUCTURED DATA</span>
                  </div>
                  <div className="inspector-json-box">
                    <pre>
                      {Object.keys(inspectorProfile).length === 0
                        ? "// No profile data in memory"
                        : JSON.stringify(
                            Object.fromEntries(
                              Object.entries(inspectorProfile).map(([k, v]) => [
                                k,
                                INSPECTOR_SENSITIVE.has(k) ? "•••••••• [PROTECTED_DATA]" : v,
                              ])
                            ),
                            null,
                            2
                          )}
                    </pre>
                  </div>
                </div>

                {/* Bottom close button */}
                <div className="inspector-close-row">
                  <button className="cyber-btn-outline" onClick={closeInspector}>
                    ← Back to Previous Page
                  </button>
                  <button className="cyber-btn-outline" onClick={loadInspectorData}>
                    ↻ Refresh Data
                  </button>
                </div>
              </div>
            ) : activeTab === "documents" ? (
              /* ISRO FORM VIEW INSIDE DOCUMENTS OPTION */
              <div className="center-content-overlay">
                <div className="form-header-banner">
                  <div className="form-title-group">
                    <h2>🚀 ISRO Member Registration Portal</h2>
                    <p>Department of Space, Government of India &bull; Member Registration Form</p>
                  </div>
                  <span className="isro-badge-tag">ISRO OFFICIAL FORM</span>
                </div>

                {/* Word file status banner */}
                {wordFileLoaded && (
                  <div style={{ background: "rgba(16, 185, 129, 0.12)", border: "1px solid #10b981", color: "#34d399", borderRadius: "10px", padding: "10px 16px", marginBottom: "14px", fontWeight: "600", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "8px" }}>
                    ✅ Word file profile loaded — form populated from your document
                    <button type="button" onClick={loadAndApplyWordProfile} style={{ marginLeft: "auto", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399", borderRadius: "6px", padding: "3px 10px", cursor: "pointer", fontSize: "0.78rem", fontWeight: "700" }}>↻ Reload</button>
                  </div>
                )}

                <form onSubmit={handleFormSubmit} noValidate>
                  {/* Section 1: Personal Information */}
                  <fieldset className="cyber-fieldset">
                    <legend>👤 Personal Information</legend>
                    <div className="cyber-grid">
                      <div className="cyber-group">
                        <label>Full Name *</label>
                        <input
                          type="text"
                          name="full_name"
                          className={`cyber-input${fieldErrors.full_name ? " cyber-input--error" : ""}`}
                          value={isroFormData.full_name}
                          onChange={handleInputChange}
                          placeholder="e.g. Shahid Khan"
                          required
                        />
                        {fieldErrors.full_name && <span className="field-error-msg">⚠ Full Name is required</span>}
                      </div>
                      <div className="cyber-group">
                        <label>Employee ID *</label>
                        <input
                          type="text"
                          name="employee_id"
                          className={`cyber-input${fieldErrors.employee_id ? " cyber-input--error" : ""}`}
                          value={isroFormData.employee_id}
                          onChange={handleInputChange}
                          placeholder="e.g. EMP2024001"
                          required
                        />
                        {fieldErrors.employee_id && <span className="field-error-msg">⚠ Employee ID is required</span>}
                      </div>
                      <div className="cyber-group">
                        <label>Date of Birth *</label>
                        <input
                          type="date"
                          name="dob"
                          className={`cyber-input${fieldErrors.dob ? " cyber-input--error" : ""}`}
                          value={isroFormData.dob}
                          onChange={handleInputChange}
                          required
                        />
                        {fieldErrors.dob && <span className="field-error-msg">⚠ Date of Birth is required</span>}
                      </div>
                      <div className="cyber-group">
                        <label>Gender *</label>
                        <select
                          name="gender"
                          className={`cyber-select${fieldErrors.gender ? " cyber-input--error" : ""}`}
                          value={isroFormData.gender}
                          onChange={handleInputChange}
                          required
                        >
                          <option value="">— Select gender —</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="non_binary">Non-binary</option>
                        </select>
                        {fieldErrors.gender && <span className="field-error-msg">⚠ Gender is required</span>}
                      </div>
                    </div>
                  </fieldset>

                  {/* Section 2: Contact Information */}
                  <fieldset className="cyber-fieldset">
                    <legend>📬 Contact Information</legend>
                    <div className="cyber-grid">
                      <div className="cyber-group">
                        <label>Email Address *</label>
                        <input
                          type="email"
                          name="email"
                          className={`cyber-input${fieldErrors.email ? " cyber-input--error" : ""}`}
                          value={isroFormData.email}
                          onChange={handleInputChange}
                          placeholder="you@example.com"
                          required
                        />
                        {fieldErrors.email && <span className="field-error-msg">⚠ Email Address is required</span>}
                      </div>
                      <div className="cyber-group">
                        <label>Phone Number *</label>
                        <input
                          type="tel"
                          name="phone"
                          className={`cyber-input${fieldErrors.phone ? " cyber-input--error" : ""}`}
                          value={isroFormData.phone}
                          onChange={handleInputChange}
                          placeholder="+91 98765 43210"
                          required
                        />
                        {fieldErrors.phone && <span className="field-error-msg">⚠ Phone Number is required</span>}
                      </div>
                      <div className="cyber-group" style={{ gridColumn: "1 / -1" }}>
                        <label>Home Address *</label>
                        <input
                          type="text"
                          name="address"
                          className={`cyber-input${fieldErrors.address ? " cyber-input--error" : ""}`}
                          value={isroFormData.address}
                          onChange={handleInputChange}
                          placeholder="Street, City, State, PIN"
                          required
                        />
                        {fieldErrors.address && <span className="field-error-msg">⚠ Home Address is required</span>}
                      </div>
                    </div>
                  </fieldset>

                  {/* Section 3: Professional Details */}
                  <fieldset className="cyber-fieldset">
                    <legend>💼 Professional Details</legend>
                    <div className="cyber-grid">
                      <div className="cyber-group">
                        <label>Division *</label>
                        <select
                          name="division"
                          className={`cyber-select${fieldErrors.division ? " cyber-input--error" : ""}`}
                          value={isroFormData.division}
                          onChange={handleInputChange}
                          required
                        >
                          <option value="">— Select division —</option>
                          <option value="aeronautics">Aeronautics</option>
                          <option value="propulsion">Propulsion</option>
                          <option value="spacecraft">Spacecraft</option>
                          <option value="avionics">Avionics</option>
                          <option value="mission_control">Mission Control</option>
                        </select>
                        {fieldErrors.division && <span className="field-error-msg">⚠ Division is required</span>}
                      </div>
                      <div className="cyber-group">
                        <label>Clearance Level *</label>
                        <select
                          name="clearance_level"
                          className={`cyber-select${fieldErrors.clearance_level ? " cyber-input--error" : ""}`}
                          value={isroFormData.clearance_level}
                          onChange={handleInputChange}
                          required
                        >
                          <option value="">— Select clearance —</option>
                          <option value="level_1">Level 1</option>
                          <option value="level_2">Level 2</option>
                          <option value="secret">Secret</option>
                          <option value="top_secret">Top Secret</option>
                        </select>
                        {fieldErrors.clearance_level && <span className="field-error-msg">⚠ Clearance Level is required</span>}
                      </div>
                    </div>
                  </fieldset>

                  {/* Section 4: Security & Actions */}
                  <fieldset className="cyber-fieldset">
                    <legend>🔐 Security &amp; Authorization</legend>
                    <div className="cyber-grid">
                      <div className="cyber-group">
                        <label>Account Password *</label>
                        <input
                          type="password"
                          name="password"
                          className={`cyber-input${fieldErrors.password ? " cyber-input--error" : ""}`}
                          value={isroFormData.password}
                          onChange={handleInputChange}
                          placeholder="Minimum 8 characters"
                          required
                        />
                        {fieldErrors.password && <span className="field-error-msg">⚠ Account Password is required</span>}
                      </div>
                      <div className="cyber-group">
                        <label>Confirm Password *</label>
                        <input
                          type="password"
                          name="confirm_password"
                          className={`cyber-input${fieldErrors.confirm_password ? " cyber-input--error" : ""}`}
                          value={isroFormData.confirm_password}
                          onChange={handleInputChange}
                          placeholder="Re-enter password"
                          required
                        />
                        {fieldErrors.confirm_password && (
                          <span className="field-error-msg">
                            {fieldErrors.confirm_password === "mismatch" ? "⚠ Passwords do not match" : "⚠ Confirm Password is required"}
                          </span>
                        )}
                      </div>
                    </div>
                  </fieldset>

                  <div className="cyber-btn-row">
                    <button type="button" className="cyber-btn-outline" onClick={openWebDemoForm}>
                      🚀 Launch External Webform
                    </button>
                    <button
                      type="submit"
                      className="cyber-btn-primary"
                      id="submit-isro-app-btn"
                    >
                      Submit ISRO Application &nbsp; ➔
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* OVERVIEW & THREE.JS 3D EARTH VIEW */
              <>
                <div className="hero-copy">
                  <div className="eyebrow">SECURE BROWSER INTELLIGENCE</div>
                  <h1>
                    Your data.
                    <br />
                    <span>Your control.</span>
                  </h1>
                </div>

                <div className="processing">
                  <span>LOCAL PROCESSING</span>
                  <strong>100%</strong>
                </div>

                {/* 3D EARTH */}
                <div className="earth-container">
                  <EarthScene />
                </div>

                {/* BOTTOM PROGRESS */}
                <div className="progress-line">
                  <div className="progress-glow"></div>
                  <div className="progress-point active"></div>
                  <div className="progress-point"></div>
                  <div className="progress-point"></div>
                  <div className="progress-point"></div>
                </div>

                <div className="progress-labels">
                  <span>DOCUMENT</span>
                  <span>PROFILE</span>
                  <span>FORM</span>
                  <span>PRIVACY</span>
                  <span>ACTION</span>
                </div>
              </>
            )}
          </section>

          {/* RIGHT PANEL */}
          <aside className="right-panel">
            <div className="panel-heading">
              <span>PRIVACY SHIELD</span>
              <strong>LIVE</strong>
            </div>

            <div className="shield-card">
              <div className="shield-icon">
                <div className="shield-ring ring-one">
                  <div className="shield-ring ring-two">
                    <div className="check">✓</div>
                  </div>
                </div>
              </div>

              <div className="protected">PROTECTED</div>
              <div className="protected-sub">All sensitive data remains local on-device.</div>
            </div>

            <div className="security-title">SECURITY STATUS</div>

            <div className="privacy-score">
              <div>
                <div className="score-label">PRIVACY SCORE</div>
                <div className="score">98</div>
              </div>

              <div className="score-bar">
                <div></div>
              </div>
            </div>
          </aside>
        </main>

        {/* FOOTER */}
        <footer className="footer">
          <div>
            <span className="status-dot"></span> LOCAL PROCESSING
          </div>
          <div>PRIVACYVISION CORE • SECURE MODE</div>
          <div>
            <span className="status-dot"></span> ALL SYSTEMS NOMINAL
          </div>
        </footer>
      </div>

      {/* ═══ MISSING FIELDS POPUP ═══ */}
      {showMissingPopup && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 999998,
            background: "rgba(1, 8, 14, 0.88)", backdropFilter: "blur(14px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowMissingPopup(false); }}
        >
          <div style={{
            background: "linear-gradient(135deg, #0d1b2a 0%, #0a1628 100%)",
            border: "1.5px solid rgba(245, 158, 11, 0.5)",
            borderRadius: "18px", padding: "36px 32px", maxWidth: "500px", width: "90%",
            boxShadow: "0 0 40px rgba(245, 158, 11, 0.15)",
            fontFamily: "Inter, sans-serif",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <span style={{ fontSize: "2rem" }}>⚠️</span>
              <div>
                <h2 style={{ margin: 0, color: "#f59e0b", fontSize: "1.25rem", fontWeight: 800 }}>
                  Missing Information
                </h2>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.82rem" }}>
                  The following fields were not found in your Word file
                </p>
              </div>
            </div>

            <div style={{ background: "rgba(245, 158, 11, 0.07)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "10px", padding: "14px 16px", marginBottom: "24px" }}>
              <ul style={{ margin: 0, paddingLeft: "18px", color: "#fbbf24", lineHeight: "2", fontSize: "0.9rem" }}>
                {missingFields.map((f) => {
                  const labels = {
                    full_name: "Full Name", employee_id: "Employee ID", dob: "Date of Birth",
                    gender: "Gender", email: "Email Address", phone: "Phone Number",
                    address: "Home Address", division: "Division", clearance_level: "Clearance Level",
                  };
                  return <li key={f}>{labels[f] || f}</li>;
                })}
              </ul>
            </div>

            <p style={{ color: "#64748b", fontSize: "0.82rem", marginBottom: "22px" }}>
              You can fill in the missing fields manually in the form, or close this popup and continue editing. The form will not submit until all required fields are filled.
            </p>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowMissingPopup(false)}
                style={{
                  background: "transparent",
                  border: "1.5px solid rgba(148,163,184,0.4)",
                  color: "#94a3b8", borderRadius: "10px",
                  padding: "10px 22px", cursor: "pointer",
                  fontWeight: 700, fontSize: "0.88rem",
                  transition: "all 0.2s",
                }}
                onMouseOver={(e) => { e.target.style.background = "rgba(148,163,184,0.1)"; e.target.style.color = "#e2e8f0"; }}
                onMouseOut={(e) => { e.target.style.background = "transparent"; e.target.style.color = "#94a3b8"; }}
              >
                ✕ Close &amp; Fill Manually
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thank You for Submitting Application Modal */}
      {showThankYouModal && (
        <div 
          className="pba-thankyou-overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
            background: "rgba(1, 8, 14, 0.85)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px"
          }}
          onClick={() => setShowThankYouModal(false)}
        >
          <div 
            className="pba-thankyou-card"
            style={{
              background: "linear-gradient(145deg, rgba(8, 22, 34, 0.98) 0%, rgba(2, 12, 20, 0.99) 100%)",
              border: "1.5px solid #10b981",
              borderRadius: "20px",
              padding: "36px 32px",
              maxWidth: "520px",
              width: "100%",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(16, 185, 129, 0.25)",
              textAlign: "center",
              color: "#e2e8f0",
              position: "relative"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowThankYouModal(false)}
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#94a3b8",
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                cursor: "pointer",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s"
              }}
            >
              ✕
            </button>

            {/* Rocket Badge Icon */}
            <div style={{
              width: "72px",
              height: "72px",
              margin: "0 auto 20px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, rgba(6, 78, 59, 0.1) 100%)",
              border: "2px solid #10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "36px",
              boxShadow: "0 0 25px rgba(16, 185, 129, 0.4)"
            }}>
              🚀
            </div>

            <div style={{
              display: "inline-block",
              padding: "4px 12px",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              borderRadius: "100px",
              color: "#34d399",
              fontSize: "0.75rem",
              fontWeight: "700",
              letterSpacing: "1px",
              textTransform: "uppercase",
              marginBottom: "12px"
            }}>
              ISRO OFFICIAL CONFIRMATION
            </div>

            <h2 style={{
              fontSize: "1.5rem",
              fontWeight: "800",
              color: "#ffffff",
              margin: "0 0 8px 0",
              letterSpacing: "-0.5px"
            }}>
              Thank You for Submitting the Application!
            </h2>

            <p style={{
              fontSize: "0.9rem",
              color: "#94a3b8",
              lineHeight: "1.5",
              margin: "0 0 24px 0"
            }}>
              Your member registration has been successfully recorded. All sensitive information was protected locally on-device.
            </p>

            {/* Summary Details Box */}
            <div style={{
              background: "rgba(2, 6, 12, 0.6)",
              border: "1px solid rgba(148, 163, 184, 0.15)",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "24px",
              textAlign: "left"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Reference ID</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.92rem", fontWeight: "700", color: "#38bdf8" }}>{submissionRef}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <span style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Applicant</span>
                <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f1f5f9" }}>{isroFormData.full_name || "Applicant"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <span style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Division</span>
                <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f1f5f9", textTransform: "capitalize" }}>{isroFormData.division || "Spacecraft"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Security Mode</span>
                <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "#10b981", background: "rgba(16, 185, 129, 0.12)", padding: "2px 8px", borderRadius: "6px", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
                  🛡️ LOCAL ON-DEVICE
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  background: "rgba(255, 255, 255, 0.07)",
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                  color: "#cbd5e1",
                  borderRadius: "10px",
                  fontWeight: "600",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onClick={() => {
                  navigator.clipboard?.writeText(submissionRef);
                  setCopiedRef(true);
                  setTimeout(() => setCopiedRef(false), 2000);
                }}
              >
                {copiedRef ? "✓ Copied Ref ID" : "📋 Copy Ref ID"}
              </button>

              <button
                type="button"
                style={{
                  flex: 1.3,
                  padding: "12px 20px",
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  border: "none",
                  color: "#ffffff",
                  borderRadius: "10px",
                  fontWeight: "700",
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  boxShadow: "0 0 16px rgba(16, 185, 129, 0.4)",
                  transition: "all 0.2s"
                }}
                onClick={() => setShowThankYouModal(false)}
              >
                Close &amp; Return ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}