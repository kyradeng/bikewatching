import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoia2tkZW5nIiwiYSI6ImNtN2s0cDgyYTAzc3gyaXEwcmN4MmNuZmsifQ.aTgYj_4AzGIfMEC-5rVOSA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

// Create or select an SVG overlay in the map container
let svg = d3.select('#map').select('svg');
if (svg.empty()) {
  svg = d3.select('#map')
          .append('svg')
          .style('position', 'absolute')
          .style('top', 0)
          .style('left', 0)
          .style('width', '100%')
          .style('height', '100%')
          .style('pointer-events', 'none'); // Allow pointer events on individual elements
}

// Declare outer-scope variables so they are accessible to all functions
let trips, stations, circles, radiusScale;
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stationFlow = d3.scaleQuantize()
.domain([0, 1])
.range([0, 0.5, 1]);

map.on('load', async () => { 
  // Add data sources
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  
  try {
    const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
    const tripurl = "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
    
    // Load station JSON and trip CSV data
    const jsonData = await d3.json(jsonurl);
    trips = await d3.csv(
      tripurl,
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        let startedMinutes = minutesSinceMidnight(trip.started_at); 
        departuresByMinute[startedMinutes].push(trip); 
        let arrivedMinutes = minutesSinceMidnight(trip.ended_at); 
        arrivalsByMinute[arrivedMinutes].push(trip); 
        return trip;
      }
    );
    
    console.log('Loaded JSON Data:', jsonData);
    
    // Compute departures and arrivals from trips (for overall totals)
    const departures = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.start_station_id
    );
    
    const arrivals = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.end_station_id
    );
    
    // Compute station traffic using a helper function.
    // When no time filter is applied, we pass -1.
    stations = computeStationTraffic(jsonData.data.stations, -1);
    stations = stations.map((station) => {
      let id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });
    console.log('Stations Array:', stations);
    
    // Create a square root scale for circle radii
    radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic)])
      .range([0, 25]);
    
    // Bind stations data to circles
    circles = svg.selectAll('circle')
  .data(stations, d => d.short_name)
  .enter()
  .append('circle')
  .attr('r', d => radiusScale(d.totalTraffic))
  .attr('stroke', 'white')
  .attr('stroke-width', 1)
  .attr('opacity', 0.6)
  // Set the fill color via CSS variable by computing the departure ratio:
  .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
  .each(function(d) {
    d3.select(this)
      .append('title')
      .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
  });
  } catch (error) {
    console.error('Error loading JSON:', error);
  }
  
  // Update positions of circles on map changes
  function updatePositions() {
    if (circles) {
      circles
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }
  }
  
  // Initial positions and event listeners for repositioning
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Attach slider event listener
if (timeSlider) {
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
  } else {
    console.error('Time slider element not found. Ensure the HTML includes an element with id="timeSlider".');
  }
  
  // Add route layers to the map
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6
    }
  });
  
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6
    }
  });
});

// Helper function: compute projected coordinates for a station
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Updated computeStationTraffic now takes a timeFilter parameter (defaulting to -1)
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Helper function to filter trips by minute range using our pre-computed arrays
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }
  
  // Normalize the minute range to [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;
  
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Helper function: convert a date to minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Optional: If you still use this for other filtering
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1 
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// Update scatter plot based on slider input.
// Note: We add a guard to ensure radiusScale is defined.
function updateScatterPlot(timeFilter) {
    // (Optional: adjust radius scale range if desired)
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
  
    // Recompute station traffic (using your computeStationTraffic function)
    const filteredStations = computeStationTraffic(stations, timeFilter);
  
    circles.data(filteredStations, d => d.short_name)
      .transition().duration(300)
      .attr('r', d => radiusScale(d.totalTraffic))
      // Update the CSS variable for the color
      .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic));
  }

// Time slider handling
const timeSlider = document.getElementById('timeSlider');
const selectedTime = document.getElementById('timeDisplay');
const anyTimeLabel = document.getElementById('anyTime');

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function updateTimeDisplay() {
  let timeFilter = Number(timeSlider.value);
  if (timeFilter === -1) {
    selectedTime.textContent = '00:00';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }
  updateScatterPlot(timeFilter);
}


console.log("Mapbox GL JS Loaded:", mapboxgl);