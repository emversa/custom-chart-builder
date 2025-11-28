# Project Status Dashboard - User Manual

## Overview

The Project Status Dashboard is a visual timeline chart that helps you track and manage multiple projects simultaneously. It displays projects as horizontal bars on a timeline, showing their duration, progress, status, and key metrics at a glance.

The timeline automatically displays a 4-month period that you can scroll through to view the full project timeline.

## What You'll See

The dashboard consists of two main sections:

- **Left Panel**: Displays project names organised in a hierarchical structure (organisations, epics, stories, and deals)
- **Timeline View**: Shows horizontal bars representing each project's duration and progress over time, with a scrollable 4-month viewport

## Understanding the Visual Elements

### Project Bars

Each project appears as a horizontal coloured bar on the timeline. The bars show:

- **Length**: How long the project runs (from start date to end date)
- **Colour**: The project category or custom colour code
- **Progress**: A darker shade fills the bar showing completion percentage (based on hours billed vs. budgeted)
- **Status Indicator**: A coloured circle at the start of the bar:
  - 🟢 Green = Completed
  - 🔵 Blue = Active
  - 🟠 Orange = At Risk
  - ⚪ Grey = In Planning or Pipeline

### Information Displayed on Bars

Depending on the bar width, you'll see:

- **Assignee Initials**: In a glass pill badge (e.g., "JS" for John Smith)
- **Hours Information**: Shows billed/estimated/budgeted hours (e.g., "120.0/150.0/180.0")
- **Completion Percentage**: A percentage badge at the end of the bar (e.g., "67%")
- **End Date**: Displayed to the right of each bar

### Hierarchy Levels

Projects are organised in a tree structure with visual indentation:

- **Organisation**: Top-level client projects (shows client badge)
- **Epic**: Major initiatives within an organisation
- **Story**: Specific tasks or features within an epic
- **Deal**: Potential future projects in the pipeline

All projects are displayed in a flattened hierarchy view. Parent-child relationships are shown through indentation levels in the left panel.

## Setting Up Your Dashboard

### Required Fields

To create the dashboard, you **must** provide these four fields:

1. **Project Name** (required): The title of each project or task
2. **Category Type** (required): Whether it's an organisation, epic, story, or deal
3. **Start Date** (required): When the project begins (must be a datetime column)
4. **End Date** (required): When the project is scheduled to complete (must be a datetime column)

Without all four required fields, the dashboard will not display properly.

### Optional Fields

You can enhance your dashboard with:

- **Project ID**: Unique identifier for each project
- **Link**: URL that opens when you click on a project bar (e.g., link to project documentation or management tool)
- **Parent ID**: Links projects together in a hierarchy (references another project's ID to create parent-child structure)
- **Client**: Client name (displayed on organisation-level items)
- **Status**: Current project status (active, at risk, completed, in planning, pipeline)
- **Assignee**: Person responsible for the project
- **Colour Code**: Visual categorisation (PURPLE, ORANGE, GREEN, GREY)
- **Hours Billed**: Actual hours worked so far
- **Hours Estimated**: Originally estimated hours
- **Hours Budgeted**: Total hours allocated for the project

## Using the Dashboard

### Navigating the Timeline

- **Scroll Horizontally**: The timeline shows a 4-month viewport. Scroll left/right to view earlier or later time periods beyond this window
- **Scroll Vertically**: Browse through all your projects by scrolling up/down
- **Timeline Header**: Shows months and week numbers for easy reference
- **Synchronised Scrolling**: The left panel and timeline scroll together vertically, and the timeline header follows horizontal scrolling

### Interacting with Projects

- **Hover Over a Bar**: See a detailed tooltip with all project information including:
  - Project name
  - Client (if provided)
  - Category
  - Status
  - Assignee
  - Hours breakdown
  - Duration dates

- **Click a Bar**: If a link is configured for that project, clicking opens the link in a new browser tab

### Reading Project Information

**Left Panel** displays:
- Hierarchical project structure with visual indentation showing parent-child relationships
- Project names
- Category badges (ORGANISATION, EPIC, STORY, DEAL)
- Client badges for organisation-level items

**Timeline Bars** show:
- Project duration (length of the bar)
- Progress visualisation (filled portion)
- Status indicator (coloured dot)
- Assignee (initials badge)
- Hours metrics
- Completion percentage

## Understanding Progress

The dashboard uses a two-tone bar system to show progress:

- **Light Background**: Represents the full project duration
- **Darker Fill**: Shows how much has been completed based on hours billed vs. hours budgeted

For example:
- If 120 hours have been billed out of 180 budgeted hours, the bar will be 67% filled
- The percentage badge at the end of the bar confirms this (showing "67%")

## Tips for Best Results

1. **Ensure required fields are populated**: Always provide Project Name, Category Type, Start Date, and End Date for every project

2. **Keep your hierarchy organised**: Use the organisation → epic → story structure to maintain clear project relationships through the Parent ID field

3. **Update hours regularly**: Keep Hours Billed current to see accurate progress visualisation

4. **Use status indicators wisely**: Regularly update project status to quickly identify projects needing attention

5. **Assign owners**: Add assignees to clearly show who's responsible for each project

6. **Add links**: Configure URLs to quickly access project details, documentation, or management tools

7. **Use consistent colour coding**: Develop a colour system that makes sense for your team (e.g., PURPLE for development, ORANGE for design, GREEN for completed)

8. **Use datetime columns**: Ensure Start Date and End Date are proper datetime columns, not text fields

## Common Scenarios

### Viewing All Client Projects
Look for items with the ORGANISATION category badge - these show all work for a specific client, with their name displayed in a badge.

### Finding At-Risk Projects
Look for bars with orange status indicators (🟠) - these are marked "At Risk" and may need attention.

### Checking Overbudget Projects
If the completion percentage exceeds 100%, the project has used more hours than budgeted.

### Tracking Individual Workload
Look for a specific person's initials on the timeline bars to see all projects they're assigned to.

### Planning Future Work
Projects marked as "Deal" or "In Planning" status (grey indicators) represent upcoming or potential work.

### Viewing Long-Term Projects
Scroll horizontally through the timeline to see projects extending beyond the initial 4-month viewport.

## Getting Help

If you encounter any issues or need clarification on how to use specific features, contact your dashboard administrator or refer to your organisation's Luzmo documentation.
