// fruits: [{ cx, cy, diameterMm, confidence, raw }]  ※cx, cyはピクセル座標
// pxPerMm: 校正で求めた「1mmあたりの画素数」
// clusterDistanceMm: この距離以内にある実は同じ房とみなす

export function clusterFruits(fruits, pxPerMm, clusterDistanceMm) {
  const n = fruits.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dxPx = fruits[i].cx - fruits[j].cx;
      const dyPx = fruits[i].cy - fruits[j].cy;
      const distMm = Math.hypot(dxPx, dyPx) / pxPerMm;
      if (distMm < clusterDistanceMm) union(i, j);
    }
  }

  const groupMap = new Map();
  fruits.forEach((fruit, i) => {
    const root = find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(fruit);
  });

  return Array.from(groupMap.values());
}

// 各クラスタ(房)で最大の実を残し、残りを摘果候補とする。
// 戻り値: 各実に action: "keep" | "thin" を付けた配列と、房ごとのサマリー。
export function decideThinning(clusters) {
  const annotated = [];
  const clusterSummaries = [];

  clusters.forEach((group, clusterIndex) => {
    const sorted = [...group].sort((a, b) => b.diameterMm - a.diameterMm);
    const keeper = sorted[0];

    sorted.forEach((fruit) => {
      annotated.push({
        ...fruit,
        clusterIndex,
        clusterSize: group.length,
        action: fruit === keeper ? "keep" : "thin",
      });
    });

    clusterSummaries.push({
      clusterIndex,
      size: group.length,
      keptDiameterMm: keeper.diameterMm,
      thinnedCount: group.length - 1,
    });
  });

  return { annotated, clusterSummaries };
}
