fetch('https://overpass-api.de/api/interpreter?data=[out:json][timeout:30];way(39.9,116.3,39.91,116.31)["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"];out geom;')
  .then(r => r.json())
  .then(d => {
    const ids = d.elements.map(e => e.id).slice(0, 10);
    console.log(ids);
    console.log(ids.map(id => {
      const idStr = String(id);
      let hash = 0;
      for (let i = 0; i < idStr.length; i++) {
        hash = (hash << 5) - hash + idStr.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash) % 100 / 100;
    }));
  });