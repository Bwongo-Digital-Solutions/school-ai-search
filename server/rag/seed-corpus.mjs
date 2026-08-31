/**
 * Bundled curriculum outlines, seeded once on first boot.
 *
 * These are *topic maps* — the sequence of themes a subject covers at a given level, with the
 * learning outcomes a teacher would plan against. They exist so the Lesson Planner and Digital
 * Examiner are useful out of the box, before anyone has uploaded a scheme of work, and so the
 * retrieval path has something real to rank in tests.
 *
 * They are a starting point, not an authority. A school's own uploaded documents are indexed
 * alongside them and outrank nothing automatically — the retriever scores on relevance, so a
 * teacher's uploaded scheme of work naturally wins for queries about their own topics. Anything
 * exam-critical should be checked against the current NCDC or Cambridge syllabus for the series
 * being taught.
 */

const UGANDA_CBC = 'uganda-cbc-lower-secondary';
const IGCSE = 'cambridge-igcse';

export const SEED_DOCUMENTS = [
  {
    title: 'Uganda Lower Secondary Biology — Topic Outline (S1–S4)',
    curriculum: UGANDA_CBC,
    subject: 'Biology',
    gradeLevel: null,
    content: `
# Introduction to Biology

Biology as the study of living things. Characteristics of living organisms: nutrition, respiration,
excretion, growth, movement, reproduction, sensitivity. Laboratory safety and the correct use of a
hand lens and a light microscope. Scientific method: observation, hypothesis, experiment, conclusion.

Learning outcome: the learner appreciates that biology explains phenomena in their own environment
and can classify familiar organisms as living or non-living with reasons.

# Cell Biology

Cell structure of plant and animal cells. Functions of the cell membrane, cytoplasm, nucleus, cell
wall, chloroplast, vacuole and mitochondria. Differences between plant and animal cells. Preparing
a wet mount slide of onion epidermis and of cheek cells. Diffusion, osmosis and active transport,
including osmosis in plant tissue.

Learning outcome: the learner explains how the structure of a cell suits its function and carries
out a simple investigation into osmosis using locally available materials.

# Nutrition in Plants

Photosynthesis: word and balanced equations, raw materials, conditions and products. The leaf as an
organ adapted for photosynthesis. Testing a leaf for starch. Investigating the necessity of light,
chlorophyll and carbon dioxide. Mineral nutrition and the effects of nitrogen, phosphorus and
potassium deficiency. Practical relevance to crop farming in Uganda.

Learning outcome: the learner investigates the factors affecting photosynthesis and relates them to
improving crop yield in their community.

# Nutrition in Animals

Food substances: carbohydrates, proteins, lipids, vitamins, mineral salts, water and roughage. Food
tests for starch, reducing sugar, protein and fat. Balanced diet and the consequences of
malnutrition, including kwashiorkor and marasmus. Human digestive system: structure, the role of
enzymes, absorption and assimilation. Dental health.

Learning outcome: the learner evaluates the diet of their household against nutritional
requirements and proposes affordable improvements.

# Transport in Organisms

Transport in flowering plants: root hair cells, xylem and phloem, transpiration and factors
affecting its rate. The human circulatory system: heart structure, blood vessels, blood composition
and the functions of red cells, white cells, platelets and plasma. Blood groups and transfusion.
Circulatory diseases and their prevention.

Learning outcome: the learner relates the structure of transport systems to their function and
explains lifestyle choices that protect the heart.

# Respiration and Gaseous Exchange

Aerobic and anaerobic respiration, with equations. Gaseous exchange surfaces and their adaptations.
The human respiratory system and the mechanism of breathing. Effects of smoking. Respiratory
diseases including tuberculosis and pneumonia, with reference to prevention and treatment.

Learning outcome: the learner investigates the products of respiration and campaigns on a
respiratory-health issue affecting their community.

# Coordination and Reproduction

The nervous system and reflex action. Sense organs. Hormonal coordination in humans and plants.
Asexual and sexual reproduction. Reproduction in flowering plants: pollination, fertilisation, seed
and fruit formation, dispersal and germination. Human reproductive system, the menstrual cycle,
fertilisation, pregnancy and birth. Adolescent health and responsible behaviour.

# Genetics, Evolution and Ecology

Variation, inheritance and monohybrid crosses using Punnett squares. Genes, chromosomes and DNA in
outline. Sickle cell trait and its relationship with malaria resistance. Natural selection.
Ecosystems, food chains and food webs, energy flow, nutrient cycles. Human impact: deforestation,
wetland degradation, pollution and conservation in the Ugandan context.
`.trim(),
  },
  {
    title: 'Uganda Lower Secondary Mathematics — Topic Outline (S1–S4)',
    curriculum: UGANDA_CBC,
    subject: 'Mathematics',
    gradeLevel: null,
    content: `
# Numbers and Number Systems

Natural numbers, integers, rational and irrational numbers. Place value and number bases,
including base two and its link to computing. Operations on directed numbers. Factors, multiples,
HCF and LCM. Prime factorisation. Approximation, rounding, significant figures and estimation.

Learning outcome: the learner uses number operations confidently in everyday transactions and
judges whether a calculated answer is reasonable.

# Fractions, Decimals, Ratio and Percentage

Equivalent fractions and the four operations. Conversion between fractions, decimals and
percentages. Ratio, rate and proportion, direct and inverse. Percentage increase and decrease.
Applications: simple and compound interest, profit and loss, discount, commission, hire purchase,
currency exchange and taxation including VAT and PAYE.

Learning outcome: the learner solves financial problems drawn from trade and household budgeting.

# Algebra

Algebraic expressions, substitution, expansion and factorisation. Linear equations and inequalities
in one variable, and their representation on a number line. Simultaneous linear equations solved by
substitution, elimination and graph. Quadratic expressions: factorisation, completing the square
and the quadratic formula. Sequences and patterns.

Learning outcome: the learner forms and solves equations to model a practical situation and
interprets the solution in context.

# Geometry and Measures

Points, lines, angles and parallel lines. Triangles, quadrilaterals and polygons: properties,
angle sums, congruence and similarity. Pythagoras' theorem. Circles: parts, angle properties and
tangents. Construction with ruler and compasses: bisectors, standard angles, triangles and loci.
Perimeter, area and volume of standard shapes and solids. Surface area of cylinders, cones and
spheres.

Learning outcome: the learner measures and calculates quantities needed for a real construction or
land-measurement task.

# Trigonometry

Sine, cosine and tangent ratios in a right-angled triangle. Solving right-angled triangles. Angles
of elevation and depression. Bearings and their use in navigation. The sine and cosine rules.

# Vectors, Matrices and Transformations

Vectors in two dimensions: notation, addition, scalar multiplication and magnitude. Matrices:
order, addition, multiplication, determinant and inverse of a 2x2 matrix. Solving simultaneous
equations by matrices. Transformations: reflection, rotation, translation, enlargement and their
matrix representation.

# Statistics and Probability

Collecting and classifying data. Frequency tables, bar charts, pie charts, histograms and frequency
polygons. Mean, median and mode for ungrouped and grouped data. Range and quartiles. Cumulative
frequency curves. Probability of single and combined events, using tree diagrams and sample space.

Learning outcome: the learner collects data on a question affecting their school, represents it
appropriately and draws a defensible conclusion.
`.trim(),
  },
  {
    title: 'Uganda Lower Secondary Chemistry — Topic Outline (S1–S4)',
    curriculum: UGANDA_CBC,
    subject: 'Chemistry',
    gradeLevel: null,
    content: `
# Matter and Its Behaviour

States of matter and the kinetic particle theory. Changes of state, diffusion and Brownian motion.
Elements, compounds and mixtures. Separation techniques: filtration, evaporation, crystallisation,
distillation, fractional distillation, chromatography and use of a separating funnel. Purity and
melting or boiling point as a test of purity.

# Atomic Structure and Bonding

Structure of the atom: protons, neutrons and electrons. Atomic number, mass number and isotopes.
Electron arrangement in the first twenty elements. The periodic table: groups, periods and trends
in Group I, Group VII and Group 0. Ionic, covalent and metallic bonding, and how bonding explains
melting point, solubility and electrical conductivity.

# Chemical Reactions and Equations

Word and balanced chemical equations with state symbols. Types of reaction: combination,
decomposition, displacement, neutralisation, precipitation, oxidation and reduction. The mole
concept: relative atomic and molecular mass, molar mass, Avogadro's constant. Calculations from
equations, including reacting masses, volumes of gases and concentration of solutions.

# Acids, Bases and Salts

Properties of acids and bases. The pH scale and indicators. Strong and weak acids. Neutralisation
and titration technique. Preparation of soluble and insoluble salts. Water of crystallisation.
Applications: soil pH management in agriculture, antacids, and water treatment.

# Rates of Reaction, Energy and Equilibrium

Factors affecting reaction rate: concentration, temperature, surface area, catalyst. Measuring rate
experimentally. Exothermic and endothermic reactions and energy level diagrams. Reversible
reactions and dynamic equilibrium in outline.

# Metals, Non-Metals and Extraction

Reactivity series and displacement. Extraction of iron in the blast furnace and of aluminium by
electrolysis. Corrosion of iron and methods of prevention. Alloys and their uses. Sulphur, nitrogen
and their important compounds, including the manufacture of ammonia and fertilisers.

# Organic Chemistry and the Environment

Sources of hydrocarbons and fractional distillation of crude oil. Alkanes, alkenes and alcohols:
general formulae, naming and simple reactions. Polymers and the problem of plastic waste. Soaps and
detergents. Air pollution, acid rain, the greenhouse effect and water pollution, with mitigation
relevant to Uganda.
`.trim(),
  },
  {
    title: 'Uganda Lower Secondary Physics — Topic Outline (S1–S4)',
    curriculum: UGANDA_CBC,
    subject: 'Physics',
    gradeLevel: null,
    content: `
# Measurement and Mechanics

Physical quantities, SI units, prefixes and dimensional consistency. Measuring length, mass, time
and volume; use of vernier callipers and micrometer screw gauge. Errors and precision. Scalars and
vectors. Speed, velocity and acceleration; distance-time and velocity-time graphs. Newton's laws of
motion. Momentum and its conservation. Moments, centre of gravity and equilibrium. Work, energy,
power and machines: levers, pulleys, inclined plane, efficiency and mechanical advantage.

# Properties of Matter

Density and relative density. Pressure in solids, liquids and gases. Hydraulic press and barometer.
Archimedes' principle and flotation. Surface tension, capillarity and viscosity in outline. Hooke's
law and elasticity.

# Heat

Temperature and its measurement; thermometer types and scales. Expansion of solids, liquids and
gases and its everyday consequences. Heat transfer by conduction, convection and radiation, and its
application to housing, cooking and the vacuum flask. Specific heat capacity, latent heat, melting,
boiling and evaporation. The gas laws in outline.

# Waves, Light and Sound

Wave motion: transverse and longitudinal, wavelength, frequency, amplitude, period and the wave
equation. Reflection and refraction of light; plane and curved mirrors; lenses and image formation
by ray diagrams. The eye and its defects. Dispersion and colour. Sound production, transmission,
reflection and the measurement of the speed of sound. Noise pollution.

# Electricity and Magnetism

Static electricity and charging by friction and induction. Electric current, potential difference
and resistance; Ohm's law. Series and parallel circuits. Electrical energy, power and domestic
wiring including the fuse, earth wire and safety. Cells and batteries. Magnets, magnetic fields and
the earth's field. Electromagnets, the motor effect and the simple DC motor. Electromagnetic
induction, the generator and the transformer. Transmission of electrical power.

# Modern Physics

Structure of the atom and radioactivity: alpha, beta and gamma emissions, half-life, detection and
safety. Uses of radioisotopes in medicine and agriculture. Nuclear fission and fusion in outline.
Renewable and non-renewable energy sources with reference to Uganda's energy mix.
`.trim(),
  },
  {
    title: 'Uganda Lower Secondary English Language — Topic Outline (S1–S4)',
    curriculum: UGANDA_CBC,
    subject: 'English',
    gradeLevel: null,
    content: `
# Listening and Speaking

Active listening for gist and for detail. Following and giving instructions and directions.
Conversation, interviews and telephone etiquette. Class debate and public speaking: structuring an
argument, rebuttal, and audience awareness. Oral narration of folk tales. Pronunciation, stress and
intonation.

# Reading and Comprehension

Reading for gist, for detail and for inference. Skimming and scanning. Summarising a passage in a
required number of words. Interpreting graphs, tables, notices, advertisements and timetables.
Distinguishing fact from opinion, and identifying a writer's purpose, tone and attitude.
Vocabulary in context; use of the dictionary and thesaurus.

# Grammar and Usage

Parts of speech. Tenses and their consistency. Active and passive voice. Direct and indirect
speech. Concord. Articles, prepositions and phrasal verbs. Conditional sentences. Simple, compound
and complex sentences. Punctuation and capitalisation. Common errors of interference from local
languages.

# Writing

The writing process: planning, drafting, revising, editing. Narrative, descriptive, argumentative,
expository and discursive composition. Functional writing: formal and informal letters, emails,
reports, minutes, notices, speeches, curriculum vitae, application letters, articles and
advertisements. Paragraphing, cohesion and register.

Learning outcome: the learner writes a coherent text appropriate to a stated audience and purpose,
using accurate grammar and a suitable register.

# Literature in English

Genres: prose, poetry and drama. Elements of plot, character, setting, theme, conflict and point of
view. Figures of speech: simile, metaphor, personification, irony, symbolism, hyperbole. Oral
literature of Uganda: proverbs, riddles, songs and folk tales, and their social function.
Responding critically to a set text with textual evidence.
`.trim(),
  },
  {
    title: 'Cambridge IGCSE Biology — Topic Outline',
    curriculum: IGCSE,
    subject: 'Biology',
    gradeLevel: null,
    content: `
# Characteristics and Classification of Living Organisms

The seven characteristics of living organisms. The binomial system of naming. Classification into
kingdoms and the main groups of vertebrates and arthropods. Use of dichotomous keys. Features of
viruses, bacteria and fungi. Classification using DNA sequence data.

Assessment note: candidates are commonly asked to construct or use a dichotomous key (AO2) and to
state defining features of a named group (AO1).

# Organisation of the Organism

Cell structure and organisation: cell, tissue, organ, organ system, organism. Specialised cells and
their adaptations. Calculating magnification and actual size from a drawing or micrograph — a
recurring calculation question.

# Movement Into and Out of Cells

Diffusion, osmosis and active transport, including the role of water potential. Investigating
osmosis using plant tissue. Plasmolysis and turgor. Effects of surface area, temperature and
distance on the rate of diffusion.

# Biological Molecules and Enzymes

Chemical elements in carbohydrates, fats and proteins. Food tests: Benedict's, iodine, biuret,
ethanol emulsion, DCPIP. Enzymes as biological catalysts; the effect of temperature and pH on
enzyme activity, explained by molecular shape and the active site. Interpreting rate-of-reaction
graphs.

# Plant Nutrition and Transport

Photosynthesis: equation, limiting factors, and investigations using aquatic plants and starch
tests. Leaf structure and adaptation. Mineral requirements. Transpiration and translocation;
structure of xylem and phloem; the effect of temperature, humidity, wind and light on transpiration
rate; using a potometer.

# Human Nutrition, Transport and Respiration

Balanced diet and deficiency diseases. Alimentary canal, mechanical and chemical digestion,
absorption and assimilation. Circulatory system: double circulation, heart structure and function,
coronary heart disease and its risk factors. Blood components and immunity. Aerobic and anaerobic
respiration including the oxygen debt. Lung structure and the effect of exercise and smoking.

# Coordination, Homeostasis and Excretion

Nervous coordination, reflex arcs, and the eye. Hormones including adrenaline, insulin and
glucagon. Homeostasis: control of blood glucose and body temperature, negative feedback. Kidney
structure and function, dialysis.

# Reproduction, Inheritance and Variation

Asexual and sexual reproduction. Reproduction in flowering plants and in humans; sexually
transmitted infections. Chromosomes, genes and DNA. Mitosis and meiosis. Monohybrid inheritance,
Punnett squares, codominance, sex linkage, pedigree diagrams. Variation, mutation, natural
selection, selective breeding, and genetic modification.

# Organisms and Their Environment

Energy flow, food chains and webs, pyramids of number, biomass and energy. Carbon and nitrogen
cycles. Population growth curves. Human impact: habitat destruction, pollution, eutrophication,
overfishing, deforestation, and conservation and sustainable resource use.
`.trim(),
  },
  {
    title: 'Cambridge IGCSE Mathematics — Topic Outline',
    curriculum: IGCSE,
    subject: 'Mathematics',
    gradeLevel: null,
    content: `
# Number

Types of number; sets and Venn diagrams. Powers, roots and standard form. Four operations with
fractions and decimals. Ordering, estimation and limits of accuracy including upper and lower
bounds. Ratio, proportion and rate. Percentages, including reverse percentage, percentage change,
simple and compound interest. Use of an electronic calculator; degree of accuracy in answers.

Assessment note: an answer is normally given to three significant figures unless the question
specifies otherwise; exact answers are required where indicated.

# Algebra and Graphs

Algebraic manipulation, expansion and factorisation including grouping and the difference of two
squares. Indices. Linear, simultaneous and quadratic equations; the quadratic formula. Inequalities
and linear programming regions. Rearranging formulae. Sequences: linear, quadratic, geometric and
the nth term. Functions: notation, composite and inverse functions. Graphs of linear, quadratic,
cubic, reciprocal and exponential functions; solving equations graphically; gradient of a curve by
tangent; distance-time and speed-time graphs.

# Coordinate Geometry

Gradient and midpoint of a line segment; length of a line segment. Equation of a straight line in
the form y = mx + c; parallel and perpendicular lines.

# Geometry, Mensuration and Trigonometry

Geometrical terms and constructions. Symmetry. Angle properties of parallel lines, polygons and
circles, including cyclic quadrilaterals and tangent properties. Similarity and congruence,
including area and volume scale factors. Perimeter, area and volume of standard shapes and solids;
arc length and sector area. Pythagoras' theorem and trigonometry in right-angled triangles;
sine rule, cosine rule and area of a triangle; three-dimensional problems; bearings.

# Vectors and Transformations

Vector notation, magnitude, addition and scalar multiplication; position vectors and vector
geometry proofs. Transformations: reflection, rotation, translation and enlargement, and describing
a transformation fully.

# Probability and Statistics

Probability of single and combined events; tree diagrams; Venn diagrams; conditional probability.
Collecting and displaying data: bar charts, pie charts, scatter diagrams with lines of best fit,
histograms with unequal intervals, cumulative frequency diagrams and box plots. Mean, median, mode
and range for discrete and grouped data; interquartile range; identifying correlation.
`.trim(),
  },
  {
    title: 'Cambridge IGCSE Chemistry — Topic Outline',
    curriculum: IGCSE,
    subject: 'Chemistry',
    gradeLevel: null,
    content: `
# States of Matter and Atoms

Solids, liquids and gases and the kinetic particle model. Changes of state, diffusion and the
effect of relative molecular mass on rate of diffusion. Elements, compounds and mixtures.
Separation and purification techniques and the interpretation of chromatograms including Rf values.
Atomic structure, isotopes, electronic configuration and the periodic table.

# Bonding and Structure

Ionic bonding and the formation of ions; covalent bonding and dot-and-cross diagrams; metallic
bonding. Giant ionic, simple molecular, giant covalent and metallic structures, and the physical
properties each explains — melting point, conductivity and solubility.

# Stoichiometry

Formulae and balanced equations with state symbols; ionic equations. Relative atomic and molecular
mass. The mole, molar mass and Avogadro's constant. Calculations involving reacting masses, gas
volumes at room temperature and pressure, and concentration in mol/dm3 and g/dm3. Limiting
reactant, percentage yield and percentage purity.

# Electrochemistry and Energetics

Electrolysis of molten compounds and of aqueous solutions; predicting products at each electrode;
electroplating. Hydrogen-oxygen fuel cells. Exothermic and endothermic reactions; reaction pathway
diagrams; bond energy calculations.

# Chemical Reactions

Rate of reaction and the factors affecting it, interpreted using collision theory; catalysts.
Reversible reactions, dynamic equilibrium and Le Chatelier's principle applied to the Haber and
Contact processes. Redox in terms of oxygen, electron transfer and oxidation number; oxidising and
reducing agents; the use of acidified potassium manganate(VII) and potassium iodide.

# Acids, Bases and the Periodic Table

Properties of acids and bases; strong and weak acids; pH and indicators. Preparation of salts and
tests for anions, cations and gases. Group I, Group VII and Group VIII properties and trends;
transition elements; metallic character across a period.

# Metals, Chemistry of the Environment and Organic Chemistry

Reactivity series and its use in predicting reactions; extraction of iron, aluminium and zinc;
rusting and its prevention; alloys. Water treatment and testing; air composition, air pollutants
and their sources and effects; the greenhouse effect and climate change; fertilisers. Fuels and
fractional distillation of petroleum. Homologous series; alkanes, alkenes, alcohols and carboxylic
acids: naming, structures, reactions and tests. Addition and condensation polymers, PET and its
hydrolysis.
`.trim(),
  },
  {
    title: 'Cambridge IGCSE Physics — Topic Outline',
    curriculum: IGCSE,
    subject: 'Physics',
    gradeLevel: null,
    content: `
# Motion, Forces and Energy

Physical quantities, SI units and measurement technique. Scalars and vectors and the resultant of
two vectors. Speed, velocity, acceleration and the interpretation of motion graphs. Free fall and
terminal velocity. Mass, weight and density. Forces: friction, extension of a spring and Hooke's
law, circular motion, Newton's laws. Moments and the principle of moments; centre of gravity and
stability. Momentum and impulse. Energy stores and transfers; work, power and efficiency; energy
resources and the use of the equations for kinetic and gravitational potential energy. Pressure,
including pressure in liquids and the use of a manometer.

# Thermal Physics

Kinetic particle model of matter; gas pressure and the relationship between pressure, volume and
temperature. Thermal expansion. Specific heat capacity and specific latent heat. Melting, boiling
and evaporation. Conduction, convection and radiation, and their consequences and applications.

# Waves

Wave properties: wavelength, frequency, amplitude, speed and the wave equation. Transverse and
longitudinal waves. Reflection, refraction and diffraction, and the use of a ripple tank. Light:
reflection in a plane mirror, refraction and refractive index, total internal reflection and
critical angle, thin converging lenses and ray diagrams, real and virtual images, dispersion. The
electromagnetic spectrum, its regions, uses and hazards. Sound: production, transmission, the
speed of sound, echoes and ultrasound.

# Electricity and Magnetism

Magnets, magnetic fields and magnetic materials. Static electricity, charging and electric fields.
Current, potential difference, resistance and the effect of length and cross-sectional area on
resistance. Series and parallel circuits and circuit calculations. Electrical energy, power and
safety, including fuses, circuit breakers and earthing. The magnetic effect of a current, the motor
effect and the DC motor. Electromagnetic induction, the AC generator, and the transformer including
the transformer equation and power transmission.

# Nuclear and Space Physics

The nuclear model of the atom; isotopes. Detection of radioactivity and background radiation.
Alpha, beta and gamma emission, their properties, penetrating power, hazards and safety precautions.
Nuclear equations and half-life, including calculations from a decay curve. Nuclear fission and
fusion. The solar system, orbits, the life cycle of a star, redshift and the Big Bang theory.
`.trim(),
  },
  {
    title: 'Cambridge IGCSE Computer Science — Topic Outline',
    curriculum: IGCSE,
    subject: 'Computer Science',
    gradeLevel: null,
    content: `
# Data Representation

Binary, denary and hexadecimal, and conversion between them. Binary addition and overflow. Logical
binary shifts. Two's complement for negative numbers. Character sets: ASCII and Unicode.
Representation of images as pixels with colour depth and resolution; representation of sound with
sample rate and resolution. File size calculations. Lossy and lossless compression and where each
is appropriate.

# Data Transmission and Networks

Packet switching. Serial and parallel, simplex, half-duplex and full-duplex transmission. USB.
Error detection: parity, checksum, echo check and check digit. Automatic repeat requests. Symmetric
and asymmetric encryption; the role of public and private keys; digital signatures and certificates.
LAN and WAN; routers, IP and MAC addresses; the internet and the World Wide Web.

# Hardware and Software

Von Neumann architecture and the fetch-decode-execute cycle; the roles of the CPU registers, the
ALU and the control unit. Factors affecting CPU performance: clock speed, cache size and number of
cores. Embedded systems. Input, output and storage devices, including magnetic, optical and solid
state, with their operation and typical uses. Virtual memory. Operating systems and utility
software. High and low level languages; compilers and interpreters; the IDE.

# Security, Ethics and the Web

Threats: malware, phishing, pharming, denial of service, brute force attacks, data interception and
SQL injection. Protection: firewalls, anti-malware, authentication, two-step verification,
biometrics, access levels and privacy settings. HTML structure and presentation; the roles of the
browser, the web server and DNS; cookies.

# Algorithms and Programming

Program development lifecycle: analysis, design, coding and testing. Decomposition, structure
diagrams, flowcharts and pseudocode. Sequence, selection, iteration (count-controlled, pre-condition
and post-condition). Variables, constants and data types. Arrays, one and two dimensional. String
handling. Procedures, functions and parameters; local and global variables. Standard methods:
totalling, counting, finding maximum, minimum and average; linear search; bubble sort. Validation
and verification checks. Trace tables and dry running. Test data: normal, abnormal, extreme and
boundary. Records, files and databases; single-table databases, primary keys, data types and SQL
SELECT, FROM, WHERE, ORDER BY, SUM and COUNT.
`.trim(),
  },
];

/**
 * Seeds the bundled outlines exactly once, in the manner of ensureStudentsSeeded() — if the corpus
 * already holds anything, leave it alone. A school that has replaced these with their own uploads
 * must not have them reappear on the next restart.
 */
export const ensureCurriculumSeeded = async (database, { httpClient = fetch } = {}) => {
  const { rows } = await database.query('SELECT COUNT(*)::int AS count FROM curriculum_documents');
  if ((rows[0]?.count ?? 0) > 0) {
    return { seeded: 0 };
  }

  // Imported lazily: retriever.mjs pulls in the embeddings layer, which is only needed when there
  // is actually something to ingest.
  const { ingestDocument } = await import('./retriever.mjs');

  let seeded = 0;
  for (const document of SEED_DOCUMENTS) {
    await ingestDocument(database, {
      ...document,
      sourceType: 'seed',
      mimeType: 'text/markdown',
      uploadedBy: 'system',
      httpClient,
      // Boot must not make a network call per chunk. These rank well lexically from the first
      // request; reindexDocuments() adds vectors later if a school configures an embedding provider.
      embed: false,
    });
    seeded += 1;
  }

  return { seeded };
};
