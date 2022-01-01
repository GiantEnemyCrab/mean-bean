'use strict';

const LEFT  = Symbol('left');
const RIGHT = Symbol('right');
const UP    = Symbol('up');
const DOWN  = Symbol('down');

const CW  = Symbol('clockwise');
const CCW = Symbol('counterclockwise');

const GRID_HEIGHT = 12;
const GRID_WIDTH  = 6;
const GRID_PITCH  = 24;

const DROP_X = Math.floor((GRID_WIDTH - 1) / 2);
const DROP_Y = 0;

const ROTATION_TABLE = Object.freeze({
  [UP]: {
    [CCW] : { x: -1, y: +1, orientation: LEFT  },
    [CW]  : { x: +1, y: +1, orientation: RIGHT },
  },
  [LEFT]: {
    [CCW] : { x: +1, y: +1, orientation: DOWN  },
    [CW]  : { x: +1, y: -1, orientation: UP    },
  },
  [DOWN]: {
    [CCW] : { x: +1, y: -1, orientation: RIGHT },
    [CW]  : { x: -1, y: -1, orientation: LEFT  },
  },
  [RIGHT]: {
    [CCW] : { x: -1, y: -1, orientation: UP    },
    [CW]  : { x: -1, y: +1, orientation: DOWN  },
  },
});

const EVENT_NAMESPACE = 'MeanBean';

const ONE_FRAME = 1000 / 60;

// Bean ////////////////////////////////////////////////////////////////

const Bean = (function () {
  let Bean = Object.create(null);
  let lastId = -1;

  Object.defineProperties(Bean, {
    'COLORS': {
      enumerable: true,
      value: Object.freeze(
        [ 'red', 'yellow', 'green', 'violet', 'blue', 'dark' ]
      )
    },

    // Bean bonds in the spritesheet are ordered as binary values
    // to get multiple bonds, just OR them together
    // e.g. { up, down, right } = 2 | 1 | 4 = 7
    'BOND_NONE'  : { enumerable: true, value: 0 },
    'BOND_DOWN'  : { enumerable: true, value: 1 },
    'BOND_UP'    : { enumerable: true, value: 2 },
    'BOND_RIGHT' : { enumerable: true, value: 4 },
    'BOND_LEFT'  : { enumerable: true, value: 8 },

    'STATE_STATIC'    : { enumerable: true, value: Symbol('static')     },
    'STATE_LEADING'   : { enumerable: true, value: Symbol('leading')    },
    'STATE_WOBBLING_H': { enumerable: true, value: Symbol('wobbling_h') },
    'STATE_WOBBLING_V': { enumerable: true, value: Symbol('wobbling_v') },
    'STATE_POPPING'   : { enumerable: true, value: Symbol('exploding')  },
    'STATE_INVISIBLE' : { enumerable: true, value: Symbol('invisible')  },
  });

  Object.defineProperties(Bean, {
    'SPRITE_OFFSETS': {
      enumerable: true,
      value: Object.freeze({
        [Bean.STATE_STATIC]     : -1,
        [Bean.STATE_WOBBLING_H] : 16,
        [Bean.STATE_WOBBLING_V] : 17,
        [Bean.STATE_LEADING]    : 18,
        [Bean.STATE_POPPING]    : 20,
      })
    },
  });

  Bean.proto = {
    id: NaN,
    color: '',
    logicalX: NaN,
    logicalY: NaN,
    displayX: NaN,
    displayY: NaN,
    group: null,
    bonds: Bean.BOND_NONE,
    visualState: Bean.STATE_STATIC,
    isRemoved: false,
    player: null,

    moveTo: function moveTo(x, y) {
      this.logicalX = x;
      this.logicalY = y;
    },

    setDisplayPosition: function setDisplayPosition(x, y) {
      this.displayX = x;
      this.displayY = y;
    },

    normalizeDisplayPosition: function normalizeDisplayPosition() {
      this.displayX = Display.OFFSETS[this.player].x + this.logicalX * GRID_PITCH;
      this.displayY = Display.OFFSETS[this.player].y + this.logicalY * GRID_PITCH;
    },

    toString: function toString() {
      return 'Bean{#' + this.id + ' ' + this.color +
        (!isNaN(this.logicalX) ? (' ' + this.logicalX + ',' + this.logicalY) : '') +
        (this.isRemoved ? '*}' : '}');
    }
  };

  Bean.create = function createBean(color) {
    let bean = Object.create(Bean.proto);

    // temp
    bean.player = GameLogic.PLAYER;

    bean.id = ++lastId;

    color = color || Bean.COLORS[0];
    bean.color = color;

    // console.log('bean created: %s', bean);

    return bean;
  };

  return Object.freeze(Bean);
}());

// Pair ////////////////////////////////////////////////////////////////

const Pair = (function () {
  let Pair = Object.create(null);

  Pair.proto = {
    beanA: null,
    beanB: null,
    orientation: UP, // from beanA to beanB
  };

  Pair.create = function createPair(beanA, beanB) {
    let pair = Object.create(Pair.proto);
    // console.log('pair created (%s, %s)', beanA, beanB);

    pair.beanA = beanA;
    pair.beanB = beanB;

    return pair;
  };

  return Object.freeze(Pair);
}());

// Group ///////////////////////////////////////////////////////////////

const Group = (function () {
  let Group = Object.create(null);
  let lastId = -1;

  Group.proto = {
    beans: null,
    id: NaN,
    color: '',
    toBeRemoved: false,

    checkConsistency: function checkConsistency() {
      let thisGroup = this;
      if (!this.beans.every((bean) => bean.group === thisGroup)) {
        throw new Error(`inconsistent group ${this}`);
      }
    },

    getLength: function getLength() {
      this.checkConsistency();
      return this.beans.length;
    },

    addBean: function addBean(bean) {
      if (this.toBeRemoved) {
        throw new Error('can’t reuse a group that has been emptied: ' + this);
      }
      if (bean.group) bean.group.removeBean(bean);
      if (!this.containsBean(bean)) this.beans.push(bean);
      bean.group = this;
      this.checkConsistency();
      this.updateBonds();
    },

    removeBean: function removeBean(bean) {
      this.checkConsistency();
      if (!this.containsBean(bean)) {
        throw new Error(`bean ${bean} not in group ${this}`);
      }
      this.beans.splice(this.beans.indexOf(bean), 1);
      bean.group = null;
      bean.bonds = Bean.BOND_NONE;
      if (this.beans.length) {
        this.updateBonds();
      }
      else {
        this.toBeRemoved = true;
        // console.log('group %s empty, won’t be used anymore', this);
      }
    },

    forEachBean: function forEachBean(func) {
      // need to iterate over a copy because beans may be removed during
      // the iteration
      this.beans.slice().forEach(func);
    },

    containsBean: function containsBean(bean) {
      return this.beans.includes(bean);
    },

    updateBonds: function updateBonds() {
      let list = this.beans.slice();
      for (let bean of list) {
        bean.bonds = Bean.BOND_NONE;
      }

      while (list.length > 1) {
        let beanA = list.pop();
        let ax = beanA.logicalX;
        let ay = beanA.logicalY;
        for (let beanB of list) {
          let bx = beanB.logicalX;
          let by = beanB.logicalY;
          if (ax === bx) {
            if (+1 === ay - by) {
              beanA.bonds |= Bean.BOND_UP;
              beanB.bonds |= Bean.BOND_DOWN;
            }
            else if (-1 === ay - by) {
              beanA.bonds |= Bean.BOND_DOWN;
              beanB.bonds |= Bean.BOND_UP;
            }
          }
          else if (ay === by) {
            if (+1 === ax - bx) {
              beanA.bonds |= Bean.BOND_LEFT;
              beanB.bonds |= Bean.BOND_RIGHT;
            }
            else if (-1 === ax - bx) {
              beanA.bonds |= Bean.BOND_RIGHT;
              beanB.bonds |= Bean.BOND_LEFT;
            }
          }
        }
      }
    },

    toString: function toString() {
      return `Group{#${this.id} ${this.color} [${this.beans.length}]}` +
        (this.beans.length ?
          (` [ ${ this.beans.map((bean) => `#${bean.id}`).join(', ') } ]`) :
          '');
    }
  };

  Group.create = function createGroup(...beans) {
    let group = Object.create(Group.proto);

    if (!beans.length) {
      throw new Error('you may not create an empty group');
    }
    group.id = ++lastId;

    group.beans = [];
    group.color = beans[0].color;
    for (let bean of beans) {
      if (bean.color !== group.color) {
        throw new Error('bean color doesn’t match group’s');
      }
      group.addBean(bean);
    }

    console.log('group created: %s', group);
    return group;
  };

  return Object.freeze(Group);
}());

// GameLogic ///////////////////////////////////////////////////////////

const GameLogic = (function () {
  let GameLogic = Object.create(null);

  Object.defineProperties(GameLogic, {
    'PLAYER'   : { enumerable: true, value: Symbol('player')   },
    'OPPONENT' : { enumerable: true, value: Symbol('opponent') },

    'STATE_UNINITIALIZED' : { enumerable: true, value: Symbol('uninitialized') },
    'STATE_INTERACTIVE'   : { enumerable: true, value: Symbol('interactive')   },
    'STATE_RESOLVING'     : { enumerable: true, value: Symbol('resolving')     },
    'STATE_GAME_OVER'     : { enumerable: true, value: Symbol('game over')     },
    'STATE_PAUSED'        : { enumerable: true, value: Symbol('paused')        },
  });

  GameLogic.proto = {
    currentPair: null,
    nextPair: null,
    beans: null,
    display: null,
    audioPlayer: null,
    server: null,
    timeHandler: null,
    score: null,
    state: GameLogic.STATE_UNINITIALIZED,

    init: function init() {
      this.state = GameLogic.STATE_INTERACTIVE;
      this.drop();
    },

    tick: function tick(time) {
      if (GameLogic.STATE_INTERACTIVE === this.state) {
        this.move(DOWN);
      }
    },

    drop: function drop() {
      if (this.beans[DROP_X][DROP_Y]) {
        this.gameOver();
        return;
      }
      for (let i = 0; i < 6; i++) {
        if (this.beans[i][-2]) {
          this.gameOver();
          return;
        }
      }

      let pair = this.getNextPair();
      console.log('=== new round: %s %s ===', pair.beanA, pair.beanB);

      pair.beanA.moveTo(DROP_X, DROP_Y - 1);
      pair.beanB.moveTo(DROP_X, DROP_Y - 2);
      pair.beanA.normalizeDisplayPosition();
      pair.beanB.normalizeDisplayPosition();
      pair.orientation = UP;
      this.currentPair = pair;
      pair.beanA.visualState = Bean.STATE_LEADING;
    },

    getNextPair: function getNextPair() {
      if (!this.nextPair) {
        this.nextPair = this.server.requestPair();
        this.setPreviewPair(this.nextPair);
      }

      let pair = this.nextPair;
      this.nextPair = this.server.requestPair();
      this.setPreviewPair(this.nextPair);
      return pair;
    },

    setPreviewPair: function setPreviewPair(pair) {
      pair.beanA.setDisplayPosition(8 * GRID_PITCH, 2.5 * GRID_PITCH);
      pair.beanB.setDisplayPosition(8 * GRID_PITCH, 3.5 * GRID_PITCH);
      this.display.registerBean(pair.beanA);
      this.display.registerBean(pair.beanB);
    },

    move: function move(dir) {
      let pair = this.currentPair;
      let ori = pair.orientation;
      let a = pair.beanA;
      let b = pair.beanB;

      let ax = a.logicalX;
      let bx = b.logicalX;
      let ay = a.logicalY;
      let by = b.logicalY;

      this.beans[ax][ay] = null;
      this.beans[bx][by] = null;

      let pushFlag = false;
      let playClipFlag = false;

      switch (dir) {
        case LEFT:
          if (ax > 0 && bx > 0 && (
              (LEFT === ori && !this.beans[bx - 1][by]) ||
              (RIGHT === ori && !this.beans[ax - 1][ay]) ||
              (!this.beans[ax - 1][ay] && !this.beans[bx - 1][by])
          )) {
            a.logicalX = ax - 1;
            b.logicalX = bx - 1;
            playClipFlag = true;
          }
          break;

        case RIGHT:
          if (ax < GRID_WIDTH - 1 && bx < GRID_WIDTH - 1 && (
              (LEFT === ori && !this.beans[ax + 1][ay]) ||
              (RIGHT === ori && !this.beans[bx + 1][by]) ||
              (!this.beans[ax + 1][ay] && !this.beans[bx + 1][by])
          )) {
            a.logicalX = ax + 1;
            b.logicalX = bx + 1;
            playClipFlag = true;
          }
          break;

        case DOWN:
          if (ay < GRID_HEIGHT - 1 && by < GRID_HEIGHT - 1 && (
              (UP === ori && !this.beans[ax][ay + 1]) ||
              (DOWN === ori && !this.beans[bx][by + 1]) ||
              (!this.beans[ax][ay + 1] && !this.beans[bx][by + 1])
          )) {
            a.logicalY = ay + 1;
            b.logicalY = by + 1;
            playClipFlag = true;
          }
          else {
            pushFlag = true;
          }
          break;
      }

      //if (playClipFlag) this.audioPlayer.playClip('move');

      a.normalizeDisplayPosition();
      b.normalizeDisplayPosition();
      this.beans[a.logicalX][a.logicalY] = a;
      this.beans[b.logicalX][b.logicalY] = b;
      if (pushFlag) this.pushDown(pair);
    },

    rotate: function rotate(dir) {
      let pair = this.currentPair;
      let a = pair.beanA;
      let b = pair.beanB;

      let ax = a.logicalX;
      let bx = b.logicalX;
      let ay = a.logicalY;
      let by = b.logicalY;

      this.beans[ax][ay] = null;
      this.beans[bx][by] = null;

      let coordChange = ROTATION_TABLE[pair.orientation][dir];

      let newBx = bx + coordChange.x;
      let newBy = by + coordChange.y;

      if (newBx >= 0 && newBx < GRID_WIDTH && newBy < GRID_HEIGHT &&
          !this.beans[newBx][newBy]) {
        // normal case
        b.logicalX = newBx;
        b.logicalY = newBy;
        pair.orientation = coordChange.orientation;
        this.audioPlayer.playClip('rotate');
      }

      else {
        // kick case
        let kickShift = {};
        if (DOWN === coordChange.orientation ||
            UP === coordChange.orientation) {
          // floor kick
          kickShift.x = 0;
          kickShift.y = -coordChange.y;
        }
        else {
          // wall kick
          kickShift.x = -coordChange.x;
          kickShift.y = 0;
        }
        newBx = ax + kickShift.x;
        newBy = ay + kickShift.y;

        if (newBx >= 0 && newBx < GRID_WIDTH && newBy < GRID_HEIGHT &&
            !this.beans[newBx][newBy]) {
          b.logicalX = ax;
          b.logicalY = ay;
          a.logicalX = newBx;
          a.logicalY = newBy;
          pair.orientation = coordChange.orientation;
          this.audioPlayer.playClip('rotate');
        }
      }

      a.normalizeDisplayPosition();
      b.normalizeDisplayPosition();
      this.beans[a.logicalX][a.logicalY] = a;
      this.beans[b.logicalX][b.logicalY] = b;
    },

    pushDown: function pushDown(pair) {
      let a = pair.beanA;
      let b = pair.beanB;

      let ax = a.logicalX;
      let bx = b.logicalX;
      let ay = a.logicalY;
      let by = b.logicalY;

      if (ay < GRID_HEIGHT - 1 && !this.beans[ax][ay + 1]) {
        this.letFall(a);
      }
      if (by < GRID_HEIGHT - 1 && !this.beans[bx][by + 1]) {
        this.letFall(b);
      }

      this.audioPlayer.playClip('land');
      this.state = GameLogic.STATE_RESOLVING;

      this.timeHandler.addTask({
        mode: TimeHandler.MODE_TIMEOUT,
        delay: 20 * ONE_FRAME,
        callback: () => { this.resolve(); },
      });
    },

    letFall: function letFall(bean) {
      // console.log('letting fall %s (at least)', bean);
      let x = bean.logicalX;
      let y = bean.logicalY;
      let oldY = y;
      while (y < GRID_HEIGHT - 1 && !this.beans[x][y + 1]) y++;
      let fallHeight = y - oldY;

      let beanToFall = bean;
      do {
        if (beanToFall.group) beanToFall.group.removeBean(beanToFall);
        oldY = beanToFall.logicalY;
        this.beans[x][oldY] = null;
        beanToFall.moveTo(x, oldY + fallHeight);
        beanToFall.normalizeDisplayPosition();
        this.beans[x][beanToFall.logicalY] = beanToFall;
        beanToFall = this.beans[x][oldY - 1];
      } while (beanToFall);
    },

    resolve: function resolve(chainLevel) {
      this.state = GameLogic.STATE_RESOLVING;
      this.currentPair.beanA.visualState = Bean.STATE_STATIC;
      this.dump();

      chainLevel = chainLevel || 0;

      let i, bean, group, adjacentBeans, lastGroup;
      let j = GRID_HEIGHT;
      let allGroups = [];
      let groupsToRemove = [];
      let hoveringBeans = [];
      let logic = this;
      let timeHandler = logic.timeHandler;

      // iterating backwards
      while (j--) for (i = GRID_WIDTH; i--; ) {
        bean = this.beans[i][j];
        if (bean) {
          adjacentBeans = [];
          // looking only left and top beans since iteration is backwards
          if (i > 0) adjacentBeans.push(this.beans[i - 1][j]);
          if (j > 0) adjacentBeans.push(this.beans[i][j - 1]);

          for (let adj of adjacentBeans) {
            if (adj && adj.color === bean.color) {
              if (adj.group && bean.group) {
                if (adj.group !== bean.group) {
                  bean.group.forEachBean(function (otherBean) {
                    adj.group.addBean(otherBean);
                  });
                }
                group = adj.group;
              }
              else if (adj.group) {
                adj.group.addBean(bean);
                group = adj.group;
              }
              else if (bean.group) {
                bean.group.addBean(adj);
                group = bean.group;
              }
              else {
                group = Group.create(bean, adj);
              }
            }
          }

          if (group && !allGroups.includes(group)) allGroups.push(group);
        }
      }

      for (let group of allGroups) {
        if (group.getLength() >= 4) {
          groupsToRemove.push(group);
        }
      }

      if (groupsToRemove.length) {
        const setStateInvisible = (bean) => bean.visualState = Bean.STATE_INVISIBLE;
        const setStateStatic    = (bean) => bean.visualState = Bean.STATE_STATIC;
        const setStatePopping   = (bean) => bean.visualState = Bean.STATE_POPPING;

        for (let n = 5; n < 27; n += 2) {
          timeHandler.addTask({
            mode: TimeHandler.MODE_TIMEOUT,
            delay: n * ONE_FRAME,
            callback: () => {
              for (let group of groupsToRemove) {
                group.forEachBean(setStateInvisible);
              }
            },
          });

          timeHandler.addTask({
            mode: TimeHandler.MODE_TIMEOUT,
            delay: (n + 1) * ONE_FRAME,
            callback: () => {
              for (let group of groupsToRemove) {
                group.forEachBean(setStateStatic);
              }
            },
          });
        }

        timeHandler.addTask({
          mode: TimeHandler.MODE_TIMEOUT,
          delay: 29 * ONE_FRAME,
          callback: () => {
            this.audioPlayer.playClip('chain' + chainLevel);
            for (let group of groupsToRemove) {
              group.forEachBean(setStatePopping);
            }
          },
        });

        timeHandler.addTask({
          mode: TimeHandler.MODE_TIMEOUT,
          delay: 60 * ONE_FRAME,
          callback: () => {
            console.log('- groups will be removed now');
            let hoveringBeans = [];

            for (let group of groupsToRemove) {
              logic.removeGroup(group);
              group.forEachBean((bean) => {
                if (bean.logicalY > 0) {
                  let beanOnTop = logic.beans[bean.logicalX][bean.logicalY - 1];
                  if (beanOnTop &&
                      beanOnTop.group !== bean.group &&
                      !beanOnTop.isRemoved) {
                    hoveringBeans.push(beanOnTop);
                  }
                }
              });
            }

            if (hoveringBeans.length) {
              timeHandler.addTask({
                mode: TimeHandler.MODE_TIMEOUT,
                delay: 350,
                callback: () => {
                  console.log('-- beans will fall now');
                  for (let bean of hoveringBeans) {
                    if (!bean.isRemoved) logic.letFall(bean);
                  }
                  logic.resolve(chainLevel + 1);
                },
              });
            }
            else {
              console.log('-- no hovering beans, end');
              logic.state = GameLogic.STATE_INTERACTIVE;
              logic.drop();
            }
          },
        });
      }
      else {
        console.log('- no groups to remove, end');
        logic.state = GameLogic.STATE_INTERACTIVE;
        logic.drop();
      }
    },

    removeGroup: function removeGroup(group) {
      console.log('removing group %s', group);
      let logic = this;
      group.forEachBean(function (bean) {
        logic.removeBean(bean);
      });
    },

    removeBean: function removeBean(bean) {
      if (bean.isRemoved) throw new Error('bean already removed ' + bean);
      // console.log('removing bean %s', bean);
      this.beans[bean.logicalX][bean.logicalY] = null;
      bean.isRemoved = true;
      this.display.unregisterBean(bean);
    },

    dump: function dump() {
      let output = '    0 1 2 3 4 5\n';
      let styles = [];
      let buffer;
      let stylesBuffer;
      let isLinePopulated;
      for (let j = 0; j < GRID_HEIGHT; j++) {
        buffer = (j < 10 ? ' ' : '') + j + ' ';
        stylesBuffer = [];
        isLinePopulated = false;

        for (let i = 0; i < GRID_WIDTH; i++) {
          let bean = this.beans[i][j];
          let symbol = '';
          if (bean) {
            isLinePopulated = true;
            symbol = '%c' + bean.color.charAt(0).toUpperCase() + '%c';
            stylesBuffer.push('color: ' + bean.color, 'color: default');
          }
          else {
            symbol = '.';
          }
          buffer += ' ' + symbol;
        }

        if (isLinePopulated) {
          output += buffer + '\n';
          styles = styles.concat(stylesBuffer);
        }
      }
      console.log.apply(console, [ output ].concat(styles));
    },

    gameOver: function gameOver() {
      console.log('======= Game Over =======');
      this.state = GameLogic.STATE_GAME_OVER;
      this.display.canPaint = false;
      for (let i = GRID_WIDTH; i--; ) {
        for (let j = GRID_HEIGHT; j--; ) {
          let bean = this.beans[i][j];
          if (bean) this.removeBean(bean);
        }
      }
    }
  };

  GameLogic.create = function createGameLogic() {
    let gameLogic = Object.create(GameLogic.proto);
    console.log('gameLogic created');

    let beans = [];
    for (let i = GRID_WIDTH; i--; ) {
      beans[i] = [];
      for (let j = GRID_HEIGHT; j--; ) {
        beans[i][j] = null;
      }
    }
    gameLogic.beans = beans;

    return gameLogic;
  };

  return Object.freeze(GameLogic);
}());

// Score ///////////////////////////////////////////////////////////////

const Score = (function () {
  let Score = Object.create(null);

  Object.defineProperties(Score, {
    'CHAIN_POWER_TABLE': {
      enumerable: true,
      value: Object.freeze(
        [ 0, 8, 16, 32, 64, 128, 256, 512, 999 ]
      )
    },
  });

  Score.proto = {
    chain: NaN,
    chainPower: NaN,

    upgradeChain: function upgradeChain() {
      this.chain = this.chain + 1 || 0;
      let powerIndex =
        Math.min(this.chain, Score.CHAIN_POWER_TABLE.length - 1);
      this.chainPower = Score.CHAIN_POWER_TABLE[powerIndex];
      console.log('chain step = %d -> power = %d',
        this.chain, this.chainPower);
    }
  };

  Score.create = function createScore() {
    let score = Object.create(Score.proto);
    console.log('score created');

    score.upgradeChain();
    return score;
  };

  return Object.freeze(Score);
}());

// Arena ///////////////////////////////////////////////////////////////

const Arena = (function () {
  let Arena = Object.create(null);

  Object.defineProperties(Arena, {
    'RATIO': { enumerable: true, value: 960 / 674 },
  });

  Arena.proto = {
    gameLogic: null,
    server: null,
    display: null,
    audioPlayer: null,

    keydown: function keydown(event) {
      if (this.gameLogic.state !== GameLogic.STATE_INTERACTIVE) return;
      switch (event.keyCode) {
        case 81: // Q
        case 65: // A (Bépo)
          event.preventDefault();
          this.gameLogic.move(LEFT);
          break;
        case 83: // S
        case 85: // U (Bépo)
          event.preventDefault();
          this.gameLogic.move(DOWN);
          break;
        case 68: // D
        case 73: // I (Bépo)
          event.preventDefault();
          this.gameLogic.move(RIGHT);
          break;
        case 37: // left arrow
          event.preventDefault();
          this.gameLogic.rotate(CCW);
          break;
        case 39: // right arrow
          event.preventDefault();
          this.gameLogic.rotate(CW);
          break;
      }
    }
  };

  Arena.create = function createArena($container) {
    let arena = Object.create(Arena.proto);
    console.log('arena created (#' + $container.id + ')');

    let server       = Server.create();
    let timeHandler  = TimeHandler.create();
    let display      = Display.create();
    let audioPlayer  = AudioPlayer.create();
    let assetManager = AssetManager.create();

    arena.server       = server;
    arena.timeHandler  = timeHandler;
    arena.display      = display;
    arena.audioPlayer  = audioPlayer;

    timeHandler.server = server;

    display.assetManager     = assetManager;
    audioPlayer.assetManager = assetManager;

    document.addEventListener(AssetManager.ALL_ASSETS_LOADED_EVENT,
      function listener(event) {
        document.removeEventListener(
          AssetManager.ALL_ASSETS_LOADED_EVENT, listener);

        let gameLogic = GameLogic.create();
        gameLogic.display     = display;
        gameLogic.audioPlayer = audioPlayer;
        gameLogic.server      = server;
        gameLogic.timeHandler = timeHandler;
        arena.gameLogic = gameLogic;

        display.setContainer($container);

        timeHandler.addTask({
          mode: TimeHandler.MODE_PER_FRAME,
          callback: (time) => {
            display.drawFrame(time);
          },
        });

        timeHandler.addTask({
          mode: TimeHandler.MODE_INTERVAL,
          delay: 1000,
          callback: (time) => {
            gameLogic.tick(time);
          },
        });

        gameLogic.init();
        timeHandler.start();

        document.addEventListener('keydown', function (event) {
          arena.keydown(event);
        }, false);
      });

    return arena;
  };

  return Object.freeze(Arena);
}());

// Server //////////////////////////////////////////////////////////////

const Server = (function () {
  let Server = Object.create(null);

  Server.proto = {
    difficulty: NaN,

    setDifficulty: function setDifficulty(difficulty) {
      this.difficulty = difficulty;
    },

    requestPair: function requestPair() {
      let dif = this.difficulty;
      if (Number.isNaN(dif)) {
        throw new Error('difficulty not set at server side');
      }

      let n = (dif > 1) ? 5 : 4;
      return Pair.create(
        Bean.create(Bean.COLORS[Math.floor(n * Math.random())]),
        Bean.create(Bean.COLORS[Math.floor(n * Math.random())])
      );
    }
  };

  Server.create = function createServer() {
    let server = Object.create(Server.proto);
    console.log('server created');

    server.setDifficulty(2); // will not stay as is

    return server;
  };

  return Object.freeze(Server);
}());

// Display /////////////////////////////////////////////////////////////

const Display = (function () {
  let Display = Object.create(null);

  let offsets = {};
  offsets[GameLogic.PLAYER] = Object.freeze({
    x: GRID_PITCH * 1,
    y: GRID_PITCH * 1
  });
  offsets[GameLogic.OPPONENT] = Object.freeze({
    x: GRID_PITCH * 13,
    y: GRID_PITCH * 1
  });

  Object.defineProperties(Display, {
    'OFFSETS': { enumerable: true, value: Object.freeze(offsets) },
  });

  Display.proto = {
    canvases: null,
    assetManager: null,
    timeHandler: null,
    beans: null,
    canPaint: false,

    setContainer: function setContainer($container) {
      let $canvas = document.createElement('canvas');
      let width  = GRID_PITCH * 20;
      let height = GRID_PITCH * 20 / Arena.RATIO;
      $canvas.width  = width;
      $canvas.height = height;

      $container.style.width = width + 'px';
      $container.style.backgroundSize = width + 'px ' + height + 'px';
      $container.appendChild($canvas);

      this.canvases = [ $canvas ];
      this.beans = [];

      this.canPaint = true;
      this.clip();
    },

    drawFrame: function drawFrame() {
      if (!this.canPaint) return;

      let $canvas = this.canvases[0];
      let drawingContext = $canvas.getContext('2d');
      drawingContext.clearRect(0, 0, $canvas.width, $canvas.height);

      for (let bean of this.beans) {
        this.drawBean(bean);
      }
    },

    drawBean: function drawBean(bean) {
      let asset = this.assetManager.getAsset('beanSprites');
      let colorOffset = Bean.COLORS.indexOf(bean.color) * asset.spriteY;

      let stateOffset = NaN;
      switch (bean.visualState) {
        case Bean.STATE_STATIC: {
          stateOffset = bean.bonds * asset.spriteX;
          break;
        }

        case Bean.STATE_LEADING:
        case Bean.STATE_POPPING: {
          stateOffset = Bean.SPRITE_OFFSETS[bean.visualState] * asset.spriteX;
          break;
        }

        case Bean.STATE_INVISIBLE: {
          break;
        }

        default: {
          throw new Error(`unhandled bean state ${bean.visualState}`);
        }
      }

      if (bean.visualState !== Bean.STATE_INVISIBLE) {
        let drawingContext = this.canvases[0].getContext('2d');
        drawingContext.drawImage(
          asset.$img,
          stateOffset, colorOffset,
          asset.spriteX, asset.spriteY,
          bean.displayX, bean.displayY,
          GRID_PITCH, GRID_PITCH
        );
      }
    },

    registerBean: function registerBean(bean) {
      if (!this.beans.includes(bean)) this.beans.push(bean);
    },

    unregisterBean: function unregisterBean(bean) {
      let index = this.beans.indexOf(bean);
      if (index < 0) {
        throw new Error('bean not registered: ' + bean);
      }
      this.beans.splice(index, 1);
    },

    clip: function clip() {
      let $cv = this.canvases[0];
      let cx = $cv.getContext('2d');

      cx.restore(); // restoring from a previous clipping
      cx.save(); // saving before clipping

      cx.beginPath();
      cx.moveTo(        0, GRID_PITCH);
      cx.lineTo($cv.width, GRID_PITCH);
      cx.lineTo($cv.width, $cv.height);
      cx.lineTo(        0, $cv.height);
      cx.closePath();
      cx.clip();
    }
  };

  Display.create = function createDisplay() {
    let display = Object.create(Display.proto);
    console.log('display created');
    return display;
  };

  return Object.freeze(Display);
}());

// AudioPlayer /////////////////////////////////////////////////////////

const AudioPlayer = (function () {
  let AudioPlayer = Object.create(null);

  AudioPlayer.proto = {
    assetManager: null,
    //audioContext: null,
    //clipMap: null,

    playClip: function playClip(clipName) {
      let $audio = this.assetManager.getAsset(clipName).$audio;

      //let source;
      //if (!this.clipMap.has(clipName)) {
      //  source = this.audioContext.createMediaElementSource($audio);
      //  source.connect(this.audioContext.destination);
      //  this.clipMap.set(clipName, source);
      //}
      //else {
      //  source = this.clipMap.get(clipName);
      //}

      $audio.currentTime = 0;
      $audio.play();
    },
  };

  AudioPlayer.create = function createAudioPlayer() {
    let audioPlayer = Object.create(AudioPlayer.proto);
    console.log('audioPlayer created');

    //audioPlayer.audioContext = new AudioContext();
    //audioPlayer.clipMap = new Map();

    return audioPlayer;
  };

  return Object.freeze(AudioPlayer);
}());

// TimeHandler /////////////////////////////////////////////////////////

const TimeHandler = (function () {
  let TimeHandler = Object.create(null);

  Object.defineProperties(TimeHandler, {
    'MODE_TIMEOUT'   : { enumerable: true, value: Symbol('timeout')   },
    'MODE_INTERVAL'  : { enumerable: true, value: Symbol('interval')  },
    'MODE_PER_FRAME' : { enumerable: true, value: Symbol('per frame') },
  });

  TimeHandler.proto = {
    server: null,
    periodicTasks: null,
    oneTimeTasks: null,

    addTask: function addTask(task) {
      if (!(task && task.mode && task.callback)) {
        throw new Error('Incorrect call to TimeHandler.addTask' + task);
      }

      switch (task.mode) {
        case TimeHandler.MODE_PER_FRAME: {
          this.periodicTasks.push(task);
          break;
        }

        case TimeHandler.MODE_TIMEOUT:
        case TimeHandler.MODE_INTERVAL: {
          task.targetTime = performance.now() + task.delay;

          // insert then sort
          this.oneTimeTasks.push(task);
          this.oneTimeTasks.sort(
            (taskA, taskB) => taskA.targetTime - taskB.targetTime
          );
          break;
        }

        default: {
          throw new Error('Unknown task mode: ', task.mode);
        }
      }
    },

    start: function start() {
      let thisTimeHandler = this;
      requestAnimationFrame(function mainLoop(time) {
        requestAnimationFrame(mainLoop);

        for (let task of thisTimeHandler.periodicTasks) {
          task.callback(time);
        }

        let oneTimeTasks = thisTimeHandler.oneTimeTasks;
        let task;
        while (oneTimeTasks[0] && oneTimeTasks[0].targetTime <= time) {
          task = oneTimeTasks.shift();
          task.callback(time);
          if (TimeHandler.MODE_INTERVAL === task.mode) {
            thisTimeHandler.addTask(task);
          }
        }
      });
    },
  };

  TimeHandler.create = function createTimeHandler() {
    console.log('timeHandler created');
    let timeHandler = Object.create(TimeHandler.proto);

    timeHandler.periodicTasks = [];
    timeHandler.oneTimeTasks = [];

    return timeHandler;
  };

  return Object.freeze(TimeHandler);
}());

// Animation ///////////////////////////////////////////////////////////

const Animation = (function () {
  let Animation = Object.create(null);

  Animation.proto = {
    startTime: NaN,
    endTime: NaN,
    paintFunction: null,
    layer: null,
  };

  Animation.create = function createAnimation() {
    let animation = Object.create(Animation.proto);


    return animation;
  };

  return Object.freeze(Animation);
}());

// AssetManager ////////////////////////////////////////////////////////

const AssetManager = (function () {
  let AssetManager = Object.create(null);

  Object.defineProperties(AssetManager, {
    'MANIFEST_URL': { enumerable: true, value: 'assets.json' },
    'ALL_ASSETS_LOADED_EVENT': {
      enumerable: true,
      value: EVENT_NAMESPACE + ':allAssetsLoaded',
    },
  });

  AssetManager.proto = {
    assets: null,
    loadCount: NaN,
    assetCount: NaN,
    errorCount: NaN,

    loadResource: function loadResource(resource) {
      switch (resource.type) {
        case 'image':
          this.loadImage(resource);
          break;

        case 'spritesheet':
          this.loadSpritesheet(resource);
          break;

        case 'audio':
          this.loadAudio(resource);
          break;

        default:
          console.warn('unhandled asset type: %s', resource.type);
          break;
      }
    },

    loadImage: function loadImage(resource) {
      let thisManager = this;
      let $img = new Image();

      $img.addEventListener('error', function () {
        thisManager.errorCount++;
        thisManager.checkCompletion();
      });

      $img.addEventListener('load', function () {
        thisManager.assets[resource.name] = $img;
        thisManager.loadCount++;
        thisManager.checkCompletion();
      });

      $img.src = resource.url;
    },

    loadSpritesheet: function loadSpritesheet(resource) {
      let $img = new Image();

      $img.addEventListener('error', () => {
        console.warn(`image asset "${resource.name}" failed to load`);
        this.errorCount++;
        this.checkCompletion();
      });

      $img.addEventListener('load', () => {
        this.assets[resource.name] = {
          $img: $img,
          spriteX: resource.spriteX,
          spriteY: resource.spriteY
        };
        this.loadCount++;
        this.checkCompletion();
      });

      $img.src = resource.url;
    },

    loadAudio: function loadAudio(resource) {
      let $audio = new Audio();
      $audio.preload = 'auto';

      $audio.addEventListener('canplay', () => {
        this.assets[resource.name] = {
          $audio: $audio,
        };
        this.loadCount++;
        this.checkCompletion();
      });

      $audio.addEventListener('error', () => {
        console.warn(`audio asset "${resource.name}" failed to load`);
        this.errorCount++;
        this.checkCompletion();
      });

      $audio.src = resource.url;
    },

    checkCompletion: function checkCompletion() {
      if (this.loadCount + this.errorCount === this.assetCount) {
        console.log(`all assets loaded, ${this.errorCount} error(s)`);
        document.dispatchEvent(
          new CustomEvent(AssetManager.ALL_ASSETS_LOADED_EVENT));
      }
    },

    getAsset: function getAsset(name) {
      if (!(name in this.assets)) {
        throw new Error('asset ' + name + ' not found');
      }
      return this.assets[name];
    }
  };

  AssetManager.create = function createAssetManager() {
    let assetManager = Object.create(AssetManager.proto);
    console.log('assetManager created');

    assetManager.assets = {};
    assetManager.loadCount = 0;
    assetManager.errorCount = 0;

    let req = new XMLHttpRequest();
    req.open('GET', AssetManager.MANIFEST_URL);

    // prevents Firefox from stupidly assuming the file is xml
    req.overrideMimeType('application/json; charset=utf-8');

    req.addEventListener('load', function () {
      let manifest;
      try {
        manifest = JSON.parse(this.responseText);
      } catch (err) {
        console.error('error while parsing asset manifest', err);
      }
      if (!manifest) return;

      assetManager.assetCount = manifest.length;
      for (let resource of manifest) {
        assetManager.loadResource(resource);
      }
    });
    req.send();

    return assetManager;
  };

  return Object.freeze(AssetManager);
}());
