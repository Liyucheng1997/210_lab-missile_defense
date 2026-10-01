// 地球与大气环境模型（公开教科书常数）。单位：km、s、kg；大气量用 SI。

export const MU = 398600.4418;        // 地心引力常数 km^3/s^2 (WGS-84)
export const RE = 6371.0;             // 平均球体半径 km（渲染与高度基准）
export const RE_EQ = 6378.137;        // 赤道半径 km（J2 项参考半径）
export const J2 = 1.08263e-3;         // 地球扁率二阶带谐系数
export const OMEGA = 7.2921159e-5;    // 地球自转角速度 rad/s
export const G0 = 9.80665;            // 标准重力 m/s^2
export const P0 = 101325;             // 海平面气压 Pa

const R_AIR = 287.053, GAMMA = 1.4, R_GEO = 6356.766;

// US Standard Atmosphere 1976，0–86 km 七层分段（位势高度）
const LAYERS = [
  // hb(km'), Tb(K), lapse(K/km'), Pb(Pa)
  [0, 288.15, -6.5, 101325],
  [11, 216.65, 0, 22632.06],
  [20, 216.65, 1.0, 5474.889],
  [32, 228.65, 2.8, 868.0187],
  [47, 270.65, 0, 110.9063],
  [51, 270.65, -2.8, 66.93887],
  [71, 214.65, -2.0, 3.956420],
];
// 86 km 以上：US76 密度表（几何高度 km, kg/m^3），对数线性插值
const UPPER = [
  [86, 6.958e-6], [90, 3.416e-6], [95, 1.393e-6], [100, 5.604e-7], [110, 9.708e-8],
  [120, 2.222e-8], [130, 8.152e-9], [150, 2.076e-9], [180, 5.194e-10], [200, 2.541e-10],
  [250, 6.073e-11], [300, 1.916e-11], [400, 2.803e-12], [500, 5.215e-13], [700, 3.07e-14],
  [1000, 3.561e-15], [1e9, 0],
];

/** 返回 {rho kg/m^3, T K, p Pa, a m/s} */
export function atmosphere(hKm) {
  if (hKm < 0) hKm = 0;
  if (hKm < 86) {
    const hg = R_GEO * hKm / (R_GEO + hKm);
    let i = LAYERS.length - 1;
    while (i > 0 && hg < LAYERS[i][0]) i--;
    const [hb, Tb, L, Pb] = LAYERS[i];
    const dh = hg - hb;
    const T = Tb + L * dh;
    const p = L === 0
      ? Pb * Math.exp(-G0 * dh * 1000 / (R_AIR * Tb))
      : Pb * Math.pow(Tb / T, G0 / (R_AIR * L / 1000));
    const rho = p / (R_AIR * T);
    return { rho, T, p, a: Math.sqrt(GAMMA * R_AIR * T) };
  }
  let i = 0;
  while (UPPER[i + 1][0] < hKm) i++;
  const [h1, r1] = UPPER[i], [h2, r2] = UPPER[i + 1];
  const rho = r2 === 0 ? r1 * Math.exp(-(hKm - h1) / 60) : r1 * Math.pow(r2 / r1, (hKm - h1) / (h2 - h1));
  const T = 186.9 + Math.min(1, (hKm - 86) / 300) * 800; // 热层温度粗略升高
  return { rho, T, p: rho * R_AIR * T, a: Math.sqrt(GAMMA * R_AIR * T) };
}

/** 引力加速度（含 J2），输入/输出 km、km/s^2，ECI 坐标 z 轴为北 */
export function gravity(x, y, z, out) {
  const r2 = x * x + y * y + z * z, r = Math.sqrt(r2), r3 = r2 * r;
  const k = 1.5 * J2 * RE_EQ * RE_EQ / r2, zz = 5 * z * z / r2;
  out[0] = -MU * x / r3 * (1 + k * (1 - zz));
  out[1] = -MU * y / r3 * (1 + k * (1 - zz));
  out[2] = -MU * z / r3 * (1 + k * (3 - zz));
  return out;
}

/** 分段线性表插值 */
export function table(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
}

export function geodeticToEcef(latDeg, lonDeg, hKm = 0) {
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180, r = RE + hKm;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
}

export function ecefToGeodetic(p) {
  const r = Math.hypot(p[0], p[1], p[2]);
  return { lat: Math.asin(p[2] / r) * 180 / Math.PI, lon: Math.atan2(p[1], p[0]) * 180 / Math.PI, h: r - RE };
}

/** 两点大圆角距（rad），输入为 ECEF 向量 */
export function centralAngle(a, b) {
  const ra = Math.hypot(...a), rb = Math.hypot(...b);
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (ra * rb);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}
