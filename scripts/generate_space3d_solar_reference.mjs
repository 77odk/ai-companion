// Independent NOAA Julian-century / orbital equations; not the runtime fractional-year algorithm.
// Source equations: https://gml.noaa.gov/grad/solcalc/calcdetails.html (geometric, no refraction).
const DEG=Math.PI/180
function altitude(utc,latitude,longitude){
  const julianDate=Date.parse(utc)/86400000+2440587.5,century=(julianDate-2451545)/36525
  const meanLongitude=(280.46646+century*(36000.76983+century*.0003032))%360
  const anomaly=357.52911+century*(35999.05029-.0001537*century)
  const eccentricity=.016708634-century*(.000042037+.0000001267*century)
  const center=Math.sin(anomaly*DEG)*(1.914602-century*(.004817+.000014*century))
    +Math.sin(2*anomaly*DEG)*(.019993-.000101*century)+Math.sin(3*anomaly*DEG)*.000289
  const omega=125.04-1934.136*century,longitudeApparent=meanLongitude+center-.00569-.00478*Math.sin(omega*DEG)
  const obliquity=23+(26+(21.448-century*(46.815+century*(.00059-century*.001813)))/60)/60+.00256*Math.cos(omega*DEG)
  const declination=Math.asin(Math.sin(obliquity*DEG)*Math.sin(longitudeApparent*DEG))
  const y=Math.tan(obliquity*DEG/2)**2
  const equation=4/DEG*(y*Math.sin(2*meanLongitude*DEG)-2*eccentricity*Math.sin(anomaly*DEG)
    +4*eccentricity*y*Math.sin(anomaly*DEG)*Math.cos(2*meanLongitude*DEG)-.5*y*y*Math.sin(4*meanLongitude*DEG)
    -1.25*eccentricity*eccentricity*Math.sin(2*anomaly*DEG))
  const date=new Date(utc),minutes=date.getUTCHours()*60+date.getUTCMinutes()
  const hourAngle=(((minutes+equation+4*longitude)%1440+1440)%1440/4-180)*DEG
  return Math.asin(Math.sin(latitude*DEG)*Math.sin(declination)+Math.cos(latitude*DEG)*Math.cos(declination)*Math.cos(hourAngle))/DEG
}
const cities=[
  ['2026-06-21T04:00:00Z',39.9042,116.4074,'Asia/Shanghai'],
  ['2026-12-21T04:00:00Z',39.9042,116.4074,'Asia/Shanghai'],
  ['2026-03-20T12:00:00Z',51.5074,-.1278,'Europe/London'],
  ['2026-06-21T16:00:00Z',40.7128,-74.006,'America/New_York'],
  ['2026-12-21T01:00:00Z',-33.8688,151.2093,'Australia/Sydney'],
]
console.log(JSON.stringify(cities.map(([utc,latitude,longitude,timezone])=>({utc,latitude,longitude,timezone,altitude:altitude(utc,latitude,longitude)})),null,2))
