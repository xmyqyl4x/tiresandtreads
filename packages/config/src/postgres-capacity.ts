// Operational reserve is already included in required; server reservations are separate.
export function postgresCapacity(
  capacity: number,
  superuserReserved: number,
  roleReserved: number,
  required: number,
) {
  if (
    ![capacity, superuserReserved, roleReserved, required].every(
      (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000,
    ) ||
    capacity < 1 ||
    required < 1 ||
    superuserReserved + roleReserved >= capacity ||
    required > capacity - superuserReserved - roleReserved
  )
    throw Error('Invalid PostgreSQL capacity');
  return Object.freeze({
    capacity,
    serverReserved: superuserReserved + roleReserved,
    usableCapacity: capacity - superuserReserved - roleReserved,
  });
}
