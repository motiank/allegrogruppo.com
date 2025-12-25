import React, { useState } from "react";
import { createUseStyles } from "react-jss";

const useStyles = createUseStyles({
  container: {
    border: "1px solid #555",
    borderRadius: 4,
    background: "#1e222b",
    color: "#e0e0e0",
    padding: 8,
    maxHeight: 200,
    overflowY: "auto",
    width: "100%",
  },
  option: {
    padding: "6px 12px",
    cursor: "pointer",
    borderRadius: 4,
    "&:hover": {
      background: "#333",
    },
  },
  group: {
    fontWeight: "bold",
    background: "#2a2f3b",
  },
  item: {
    paddingLeft: 24,
  },
  selected: {
    background: "#4caf50 !important",
    color: "#fff",
  },
});

export default function GroupedMultiSelect({ options, onChange }) {
  const classes = useStyles();
  const [selected, setSelected] = useState([]);

  const toggleSelect = (value) => {
    const updated = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];

    setSelected(updated);
    onChange?.(updated);
  };

  return (
    <div className={classes.container}>
      {options.map((group) => (
        <div key={group.label}>
          <div
            className={`${classes.option} ${classes.group} ${selected.includes(group.value) ? classes.selected : ""}`}
            onClick={() => toggleSelect(group.value)}
          >
            {group.label}
          </div>
          {group.items.map((item) => (
            <div
              key={item.value}
              className={`${classes.option} ${classes.item} ${selected.includes(item.value) ? classes.selected : ""}`}
              onClick={() => toggleSelect(item.value)}
            >
              {item.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
