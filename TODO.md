# App

1. If no connection, check if connection can be made to say google.com. If yes then send error message. At present all connection errors are assumed to be due to urlwatcher server not being connected.
1. [https://stackoverflow.com/questions/29032050/can-i-prevent-forever-from-restarting-my-node-script-in-certain-cases](Graceful) shutdown with forever 
1. Catch address in use
1. Auto-replace slashes in test ID with hyphens
1. Reload metadata if changed
1. https://stackoverflow.com/a/39128820
1. Option to write work files - these files take up a lot of space. Perhaps exclude body or when fail save lastBodyPass and currentBody?
1. For test, set threshold for download, total, and firstByte to value near their averages.
1. Instructions on testing email client.
1. Show alert threshold for ttfb, etc., on plots
1. Use timeout parameter in request.js

# Plot

1. Consider using https://github.com/leeoniya/uPlot. Much faster. One drawback is that it uses Canvas, which is raster. It may be possible to export to SVG using https://gliffy.github.io/canvas2svg/; see also https://stackoverflow.com/questions/45563420/exporting-chart-js-charts-to-svg-using-canvas2svg-js.
1. Try using HighCharts instead of Plotly. Plotly wraps d3.js and it omits many important parts (see comments in code). Plotly/d3.js uses SVG and much effort would be needed to improve speed (see https://blog.scottlogic.com/2014/09/19/d3-svg-chart-performance.html). (However, try using Plot.ly's ScatterGL; would need to switch to lines - see html/scattergl for possible fix to speed issue). Could also implement something like http://datashader.org/index.html). HighCharts uses HTML Canvas and has many speed optimizations, better documentation, more options, is free for academic use, and robust development group. Others that use canvas are Flot, CanvasJS, RGraph, http://smoothiecharts.org/. Also consider https://mango-is.com/blog/engineering/pre-render-d3-js-charts-at-server-side/ and https://community.plot.ly/t/how-to-perform-server-side-manipulation-using-plotly-js/1077/6.
1. Consider https://plot.ly/python/plotly-express/
