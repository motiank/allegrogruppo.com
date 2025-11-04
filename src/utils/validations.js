/**
 * Validation utilities
 */

export const validateBuilding = (building) => {
  return ['C', 'I', 'T', 'Y'].includes(building);
};

export const validateFloor = (floor) => {
  const num = parseInt(floor, 10);
  return !isNaN(num) && num > 0 && num <= 100;
};

export const validateOffice = (office) => {
  return office && office.trim().length > 0;
};

export const validatePhone = (phone) => {
  // Israeli phone number validation (basic)
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 9 && cleaned.length <= 10;
};

export const validateLocationForm = (formData) => {
  return (
    validateBuilding(formData.building) &&
    validateFloor(formData.floor) &&
    validateOffice(formData.office) &&
    validatePhone(formData.phone)
  );
};

