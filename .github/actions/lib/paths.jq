def output_paths:
  split("\n") | map(rtrimstr("\r") | select(length > 0) | sub("^(\\./)+"; "") | sub("/+$"; "")) |
  if all(.[]; length > 0 and startswith("/") == false and
      (split("/") | all(.[]; . != "..")) and . != "." and . != ".git" and startswith(".git/") == false)
  then unique else error("Post-update paths must name files or directories inside the repository") end;
