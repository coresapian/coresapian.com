// state.js - Central shared state object (S)
// All runtime state lives here. Every module imports and reads/writes S directly.

const S = {
  // Three.js core refs (set during init)
  scene: null,
  renderer: null,
  camera: null,
  cameraYaw: null,
  cameraPitch: null,
  clock: null,

  // Config (loaded from config.yaml)
  CFG: {},
  settings: {},

  // Controls
  controls: {
    isLocked: false,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    sprint: false,
    jump: false,
    crouch: false,
    _lockListeners: [],
    _unlockListeners: [],
    addEventListener(event, fn) {
      if (event === 'lock') this._lockListeners.push(fn);
      if (event === 'unlock') this._unlockListeners.push(fn);
    },
    removeEventListener(event, fn) {
      if (event === 'lock') this._lockListeners = this._lockListeners.filter(f => f !== fn);
      if (event === 'unlock') this._unlockListeners = this._unlockListeners.filter(f => f !== fn);
    }
  },

  // Input
  keys: {},
  touchState: {
    active: false,
    moveX: 0,
    moveY: 0,
    lookDeltaX: 0,
    lookDeltaY: 0,
    sprinting: false,
    lookTouchId: null,
    moveTouchId: null
  },

  // Device
  isTouchDevice: false,
  isMobile: false,

  // Physics
  velocity: { x: 0, y: 0, z: 0 },
  onGround: true,
  currentEyeHeight: 1.6,
  collisionMeshes: [],
  headBobTime: 0,
  floorY: null,
  devMode: false,
  sceneBounds: null,

  // Player position (set on cameraYaw)
  // Access via S.cameraYaw.position

  // Scene objects
  environmentGroup: null,
  pickableItems: [],       // { id, name, description, icon, mesh, config }
  highlightedItem: null,

  // Inventory
  inventory: {
    isOpen: false,
    items: []  // Array of item objects { id, name, description, icon, color }
  },

  // Interaction
  interactionRaycaster: null,
  promptElement: null,

  // Mobile UI refs
  joystickBase: null,
  joystickThumb: null,
  lookZone: null,
  mobilePickupBtn: null,

  // Misc
  loaded: false,
  animFrameId: null
};

export default S;
