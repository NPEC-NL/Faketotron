# Faketotron User Guide

A mock Fytotron Client protocol editor and viewer (.Html, runs in the browser). Faketotron helps you build complex Wageningen walk-in chambers G4-G8 protocols.

**Intended for:** NPEC operators and users

## Credits & Version

- **Made by:** Danna Shao and Maarten Bots
- **Developed by:** Maarten Bots
- **With instructions from:** Sofia Bengoa Luoni, Alan Pauls, and Rick van de Zedde
- **Version:** V1 (21-11-2025)

## Why use Faketotron instead of PSI Fytotron?

Faketotron has all the same original features from PSI Fytotron, with some added features:

- ✓ **Internet accessible:** Access it via https://www.npec.nl/faketron.html
- ✓ **Enhanced visualizations:** More graphs and fine-tuning options
- ✓ **Copy-paste efficiency:** Generate a protocol for 24 hours, select it and copy-paste it 45 times for a 45-day experiment
- ✓ **CSV import:** Import time-series data via CSV in seconds resolution and paste it over one of the phases, and again, copy-paste that as much as you want
- ✓ **Optimized storage:** Compared to the Fytotron which makes rows of 100,000s of seconds for a CSV import, the Faketotron only stores seconds when there is a change, which makes it more stable and makes CSV import a lot more useful and work for a full week if wanted
- ✓ **Export & reload:** Export machine-readable .fyt files (for PSI) and load an existing Fytotron .fyt back in to review or modify

## Limits & Best Practices

⚠️ **Read before long runs:**

- **Maximum duration:** 45 days is recommended for protocols
- **Time format:** D.HH:MM:SS (Days.Hours:Minutes:Seconds) - Faketotron supports second-level timing
  - Examples:
    - `01:30:00` = 1 hour 30 minutes
    - `1.00:00:00` = exactly 24 hours
    - `1.06:00:00` = 30 hours
- **Group duration:** Total duration of each group must be the same
- **Constant parameters:** If a parameter doesn't need changes, still add a single constant phase for the full duration (e.g., UV light, add it but put it to 0 over the whole experiment length)
- **Humidity minimum:** 50 is the minimum you can set it at
- **CO₂:** There is no CO₂ scrubbing
- **Edit Groups:** Do not use Edit Groups except if you are using non-standard Groups, which you most likely are not

## Key Concepts

### Variables (what you control)
Examples: Temperature, CO₂, Cool White, Deep Red, Far Red, Humidity, UVB

### Phases (how values change over time)
Protocols are built from phases that run in order. Common types:

- **Constant:** Hold one value for a duration
  - Example: 21 °C for 16 hours
- **Ramp:** Move linearly from start to end
  - Example: 16 → 21 °C in 30 minutes
- **Sine:** Smooth oscillation between min/max with a period
  - Example: Circadian-like changes
- **Cloud:** Pseudo-random "cloud cover" behavior
  - Useful for realistic flicker patterns (if enabled/available)

## Quick Start (Recommended Workflow)

Feel free to play around and load an example protocol to explore. Download example protocols: **G4, G5, G6, G7, G8** (including crazy experimental variants)

### Loading or Creating a Protocol

- **Load protocol:** Choose "Load" and select a .fyt file to tweak an existing standard protocol
- **New protocol:** Choose "New" in the protocol panel

### Building the Protocol: Adding Phases Step-by-Step

1. Pick a Group (e.g., Temperature Group 1)
2. Click Add Phase
3. Choose the phase type (Constant / Ramp / Sine / Cloud)
4. Enter value(s) and duration
5. Repeat until the full schedule is defined
6. Drag rows if you need to reorder phases
7. **Tip:** Make some groups 24 hours, and copy-paste them 45 times
8. Make sure ALL Groups have the same Group duration, so make sure constant Groups which are constant throughout the experiment are for example 45 days long constant, like UVB at 0

### Save / Export

- Before saving, add a clear description such as: experiment name, chamber, start date intention and some protocol controls
- **Save .fyt:** Machine-readable protocol file for PSI systems

## Application Tabs Overview

### 📝 Editor Tab
The main protocol editor interface. Here you can create, edit, and manage your protocol phases. Add groups, define phases (constant, ramp, sine, cloud), set durations, and arrange the sequence of your experiment. This is where you'll spend most of your time building protocols.

### 📊 Graph Tab
Visualize your protocol over time. See all your variables (temperature, light, humidity, etc.) plotted on interactive graphs. This helps you spot inconsistencies, verify ramps and transitions, and get a complete overview of your experiment timeline. Perfect for presentations and validation.

### 💡 Light Tools Tab
Advanced light spectrum management. Fine-tune individual light channels (Cool White, Warm White, Deep Red, Far Red, UVB, etc.). Calculate PPFD values, manage light ratios, and ensure your lighting conditions match your experimental requirements precisely.

### 📄 CSV Tab
Import time-series data from CSV files with second-level resolution. Paste imported data over existing phases to create complex, data-driven protocols. Useful for replicating real-world conditions from sensor data or implementing custom environmental patterns from external sources.

### 🔍 FYT Inspector Tab (Hidden)
This tab is intentionally hidden but kept for future debugging purposes. It allows inspection of the raw .fyt file structure and binary data for advanced troubleshooting.

## Included Example Protocols

- **G4, G5, G6, G7, G8** (including crazy experimental variants)

## Disclaimer

This software is an independent, non-commercial imitation of certain user interface features from the Protocol Editor component of the Fytotron Client by Photon Systems Instruments (PSI). It is provided solely for academic, educational, and research purposes. 

**This software is NOT:**
- Affiliated with, endorsed by, or produced by PSI
- Capable of connecting to, controlling, or operating any real instruments
- Authorized for production, clinical, agricultural, or commercial settings

All trademarks, product names, and intellectual property rights remain the sole property of their respective owners. This imitation does not connect to, control, or operate any real instruments and must not be used in any production, clinical, agricultural, or commercial setting. Any resemblance to the original software is for educational purposes only.

---

© 2025 NPEC - Netherlands Plant Eco-phenotyping Centre  
For educational and research purposes only
