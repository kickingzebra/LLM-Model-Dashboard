function toIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (/^\d{8}T\d{6}Z?$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace('.000Z', 'Z');
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }

  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  var value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  return (i >= 2 ? value.toFixed(1) : Math.round(value)) + ' ' + units[i];
}

module.exports = {
  toIsoTimestamp,
  formatBytes
};
